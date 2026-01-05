// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

const parseLimit = (raw: any) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(80, Math.floor(n)));
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });

    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.slice(7);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const limit = parseLimit(req.query.limit);

    // Prefer a join if the FK relationship exists; fall back to 2 queries.
    let rows: any[] = [];
    try {
      const { data, error } = await admin
        .from("sepbook_mentions")
        .select(
          "post_id, mentioned_user_id, created_at, is_read, post:sepbook_posts(id, created_at, user_id, author_name, author_avatar, author_team, content_md, attachments)"
        )
        .eq("mentioned_user_id", uid)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      rows = (data as any[]) || [];
    } catch {
      const { data: mentions, error: mentionsErr } = await admin
        .from("sepbook_mentions")
        .select("post_id, mentioned_user_id, created_at, is_read")
        .eq("mentioned_user_id", uid)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (mentionsErr) throw mentionsErr;
      const postIds = Array.from(new Set((mentions || []).map((m: any) => m.post_id).filter(Boolean)));
      let postsById: Record<string, any> = {};
      if (postIds.length) {
        const { data: posts } = await admin
          .from("sepbook_posts")
          .select("id, created_at, user_id, author_name, author_avatar, author_team, content_md, attachments")
          .in("id", postIds);
        (posts || []).forEach((p: any) => (postsById[String(p.id)] = p));
      }
      rows = (mentions || []).map((m: any) => ({ ...m, post: postsById[String(m.post_id)] || null }));
    }

    return res.status(200).json({ items: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
