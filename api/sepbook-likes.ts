// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv, DJT_QUEST_SUPABASE_HOST } from "../server/env-guard.js";
import { getSupabaseUrlFromEnv } from "../server/lib/supabase-url.js";

const SUPABASE_URL =
  getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true }) ||
  (process.env.SUPABASE_URL as string);
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const authed =
      token && ANON_KEY
        ? createClient(SUPABASE_URL, ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
        : null;

    if (!SERVICE_ROLE_KEY && !authed) return res.status(401).json({ error: "Unauthorized" });

    const postId = String(req.query.post_id || "").trim();
    if (!postId) return res.status(400).json({ error: "post_id required" });

    const reader = SERVICE_ROLE_KEY ? admin : authed;
    const { data: likes, error } = await reader
      .from("sepbook_likes")
      .select("user_id, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .limit(120);

    if (error) {
      const msg = String(error.message || "");
      if (/(row level security|rls|permission denied|not authorized)/i.test(msg)) {
        return res.status(403).json({
          error:
            "Permissão insuficiente para ler curtidas (RLS). Configure políticas de leitura no Supabase ou defina SUPABASE_SERVICE_ROLE_KEY no Vercel.",
        });
      }
      return res.status(400).json({ error: error.message });
    }

    const userIds = Array.from(new Set((likes || []).map((l: any) => l.user_id).filter(Boolean)));
    let profiles: any[] = [];
    try {
      const resp = await reader
        .from("profiles")
        .select("id, name, sigla_area, avatar_url, operational_base")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
      profiles = (resp.data as any[]) || [];
    } catch {
      profiles = [];
    }

    const profileMap = new Map<string, { name: string; sigla_area: string | null; avatar_url: string | null; operational_base: string | null }>();
    (profiles || []).forEach((p) => {
      profileMap.set(p.id, {
        name: p.name,
        sigla_area: p.sigla_area,
        avatar_url: p.avatar_url,
        operational_base: (p as any).operational_base || null,
      });
    });

    const items = (likes || []).map((like: any) => {
      const prof = profileMap.get(like.user_id) || {
        name: "Colaborador",
        sigla_area: null,
        avatar_url: null,
        operational_base: null,
      };
      return {
        user_id: like.user_id,
        name: prof.name,
        sigla_area: prof.sigla_area,
        avatar_url: prof.avatar_url,
        operational_base: prof.operational_base,
        created_at: like.created_at,
      };
    });

    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
