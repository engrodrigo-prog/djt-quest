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
    let postRows: any[] = [];
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
      postRows = (data as any[]) || [];
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
      postRows = (mentions || []).map((m: any) => ({ ...m, post: postsById[String(m.post_id)] || null }));
    }

    // Comment mentions (newer schema). Fallback to empty if table/relationship doesn't exist yet.
    let commentRows: any[] = [];
    try {
      const { data, error } = await admin
        .from("sepbook_comment_mentions")
        .select(
          "comment_id, post_id, mentioned_user_id, created_at, is_read, comment:sepbook_comments(id, user_id, content_md, created_at)"
        )
        .eq("mentioned_user_id", uid)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      commentRows = (data as any[]) || [];
    } catch {
      commentRows = [];
    }

    if (commentRows.length) {
      try {
        const commenterIds = Array.from(
          new Set(commentRows.map((r: any) => String(r?.comment?.user_id || "").trim()).filter(Boolean)),
        );
        if (commenterIds.length) {
          const { data: profs } = await admin
            .from("profiles")
            .select("id, name, sigla_area, avatar_url")
            .in("id", commenterIds.slice(0, 200));
          const map: Record<string, any> = {};
          (profs || []).forEach((p: any) => (map[String(p.id)] = p));
          commentRows = commentRows.map((r: any) => {
            const pid = String(r?.comment?.user_id || "").trim();
            const prof = pid ? map[pid] : null;
            return {
              ...r,
              comment_author_name: prof?.name || null,
              comment_author_team: prof?.sigla_area || null,
              comment_author_avatar: prof?.avatar_url || null,
            };
          });
        }
      } catch {
        // ignore
      }
    }

    const items = [
      ...(postRows || []).map((m: any) => ({ ...m, kind: "post", comment_id: null })),
      ...(commentRows || []).map((m: any) => ({
        ...m,
        kind: "comment",
        post: null,
      })),
    ]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
