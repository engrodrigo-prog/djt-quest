// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(200).json({
        items: [],
        meta: { warning: "Supabase não configurado no servidor (SUPABASE_URL/SUPABASE_*_KEY)." },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const authed =
      token && ANON_KEY
        ? createClient(SUPABASE_URL, ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
        : null;

    if (!SERVICE_ROLE_KEY && !authed) {
      return res.status(200).json({
        items: [],
        meta: { warning: "Autenticação ausente para sugerir tags (env sem SUPABASE_SERVICE_ROLE_KEY)." },
      });
    }

    const reader = SERVICE_ROLE_KEY ? admin : (authed || admin);

    const { data: campaigns, error: campaignsError } = await reader
      .from("campaigns")
      .select("id, title")
      .eq("is_active", true)
      .order("title")
      .limit(20);

    const { data: challenges, error: challengesError } = await reader
      .from("challenges")
      .select("id, title")
      .in("status", ["active", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(20);

    const anyErr = campaignsError || challengesError;
    if (anyErr) {
      if (/(row level security|rls|permission denied|not authorized)/i.test(String(anyErr.message || ""))) {
        return res.status(200).json({
          items: [],
          meta: { warning: "Permissão insuficiente para ler campanhas/desafios (RLS)." },
        });
      }
      return res.status(200).json({ items: [], meta: { warning: "Falha ao carregar tags sugeridas do SEPBook." } });
    }

    const campaignTags =
      campaigns?.map((c) => ({
        kind: "campaign",
        id: c.id,
        label: c.title,
        tag: `camp_${String(c.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")}`,
      })) || [];

    const challengeTags =
      challenges?.map((c) => ({
        kind: "challenge",
        id: c.id,
        label: c.title,
        tag: `desafio_${String(c.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")}`,
      })) || [];

    const items = [...campaignTags, ...challengeTags];

    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
