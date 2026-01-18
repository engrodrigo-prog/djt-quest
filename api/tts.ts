import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

import { assertDjtQuestServerEnv, DJT_QUEST_SUPABASE_HOST } from "../server/env-guard.js";
import { getSupabaseUrlFromEnv } from "../server/lib/supabase-url.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "";
const OPENAI_TTS_VOICE_MALE = process.env.OPENAI_TTS_VOICE_MALE || "";
const OPENAI_TTS_VOICE_FEMALE = process.env.OPENAI_TTS_VOICE_FEMALE || "";

const SUPABASE_URL = getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true });
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_PUBLIC_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  "";

const BUCKET = "tts-cache";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h
const MAX_TEXT_CHARS = 1800;

const uniq = <T,>(arr: T[]) => Array.from(new Set(arr.filter(Boolean as any)));

const MODELS = uniq([OPENAI_TTS_MODEL, "gpt-4o-mini-tts", "tts-1"]);

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const hashFor = (input: string) => crypto.createHash("sha256").update(input).digest("hex");

const pickVoice = (voiceGender: string | undefined) => {
  const g = String(voiceGender || "").toLowerCase();
  // OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
  if (g === "female") return (OPENAI_TTS_VOICE_FEMALE || "nova").trim() || "nova";
  return (OPENAI_TTS_VOICE_MALE || "alloy").trim() || "alloy";
};

async function ensureBucket(supabaseAdmin: any) {
  try {
    const { data } = await (supabaseAdmin.storage as any).getBucket(BUCKET);
    if (!data) {
      await (supabaseAdmin.storage as any).createBucket(BUCKET, { public: false });
    }
  } catch {
    /* best-effort */
  }
}

async function openAiTtsMp3(params: { model: string; voice: string; input: string; speed: number }) {
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      voice: params.voice,
      input: params.input,
      response_format: "mp3",
      speed: params.speed,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`openai tts failed (${resp.status}): ${t || resp.statusText}`);
  }
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Invalid server environment" });
  }

  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    if (!SUPABASE_URL || (!SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_PUBLIC_KEY)) {
      return res.status(500).json({ error: "Missing Supabase configuration (SUPABASE_URL + key)" });
    }

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLIC_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = (req.headers["authorization"] as string | undefined) || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const { data: me, error: meErr } = await supabaseAuth.auth.getUser(token);
    if (meErr || !me?.user) return res.status(401).json({ error: "Unauthorized" });

    const { text, locale, voiceGender, rate } = (req.body || {}) as any;
    const input = String(text || "").trim();
    if (!input) return res.status(400).json({ error: "Missing text" });
    if (input.length > MAX_TEXT_CHARS) return res.status(400).json({ error: `Text too long (max ${MAX_TEXT_CHARS})` });

    const safeLocale = String(locale || "pt-BR").trim() || "pt-BR";
    const voice = pickVoice(voiceGender);
    const speed = clamp(Number(rate) || 1, 0.25, 2);

    const cacheKey = hashFor(JSON.stringify({ input, locale: safeLocale, voice, speed, v: 1 }));
    const objectPath = `tts/${cacheKey}.mp3`;

    const canCache = Boolean(SUPABASE_SERVICE_ROLE_KEY);
    const supabaseAdmin = canCache
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
      : null;

    if (supabaseAdmin) {
      await ensureBucket(supabaseAdmin);

      // Cache hit: return a signed URL
      {
        const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
        if (!error && signed?.signedUrl) {
          return res.status(200).json({ url: signed.signedUrl, cache: "hit" });
        }
      }
    }

    // Cache miss: generate on OpenAI + upload
    let lastError: any = null;
    let bytes: Buffer | null = null;
    for (const model of MODELS) {
      try {
        bytes = await openAiTtsMp3({ model, voice, input, speed });
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!bytes) {
      return res.status(500).json({ error: lastError?.message || "TTS failed" });
    }

    if (!supabaseAdmin) {
      return res.status(200).json({ audioBase64: bytes.toString("base64"), mime: "audio/mpeg", cache: "none" });
    }

    try {
      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(objectPath, bytes, { contentType: "audio/mpeg", upsert: true });
      if (!upErr) {
        const { data: signed2, error: signErr2 } = await supabaseAdmin.storage
          .from(BUCKET)
          .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
        if (!signErr2 && signed2?.signedUrl) {
          return res.status(200).json({ url: signed2.signedUrl, cache: "miss" });
        }
      }
    } catch {
      /* fall back below */
    }

    // Fallback if caching/signing fails
    return res.status(200).json({ audioBase64: bytes.toString("base64"), mime: "audio/mpeg", cache: "none" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error in /api/tts" });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: "1mb" },
  },
};
