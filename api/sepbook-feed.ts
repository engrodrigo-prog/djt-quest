// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    let currentUserId: string | null = null;
    if (token) {
      try {
        const { data } = await admin.auth.getUser(token);
        currentUserId = data?.user?.id || null;
      } catch {}
    }

    const { data: posts, error } = await admin
      .from("sepbook_posts")
      .select("id, user_id, content_md, attachments, like_count, comment_count, created_at, location_label")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      // Se a tabela ainda não existir (migração não aplicada), devolve lista vazia e dica de migração
      if (/sepbook_posts/i.test(error.message) && /relation|table.*does not exist/i.test(error.message)) {
        return res.status(200).json({ items: [], meta: { warning: "Tabela sepbook_posts ausente. Aplique a migração supabase/migrations/20251115153000_sepbook.sql." } });
      }
      return res.status(400).json({ error: error.message });
    }

    const userIds = Array.from(new Set((posts || []).map((p) => p.user_id)));
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name, sigla_area, avatar_url, operational_base")
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

    let myLikes: any[] = [];
    if (currentUserId) {
      const postIds = (posts || []).map((p) => p.id);
      const { data: likes } = await admin
        .from("sepbook_likes")
        .select("post_id")
        .eq("user_id", currentUserId)
        .in("post_id", postIds.length ? postIds : ["00000000-0000-0000-0000-000000000000"]);
      myLikes = likes || [];
    }

    const likedSet = new Set<string>(myLikes.map((l) => l.post_id));
    const profileMap = new Map<string, { name: string; sigla_area: string | null; avatar_url: string | null; operational_base: string | null }>();
    (profiles || []).forEach((p) => {
      profileMap.set(p.id, { name: p.name, sigla_area: p.sigla_area, avatar_url: p.avatar_url, operational_base: (p as any).operational_base || null });
    });

    const items = (posts || []).map((p) => {
      const prof = profileMap.get(p.user_id) || { name: "Colaborador", sigla_area: null, avatar_url: null, operational_base: null };
      return {
        id: p.id,
        user_id: p.user_id,
        author_name: prof.name,
        author_team: prof.sigla_area,
        author_avatar: prof.avatar_url,
        author_base: prof.operational_base,
        content_md: p.content_md,
        attachments: Array.isArray(p.attachments) ? p.attachments : [],
        like_count: p.like_count || 0,
        comment_count: p.comment_count || 0,
        created_at: p.created_at,
        location_label: p.location_label,
        has_liked: likedSet.has(p.id),
      };
    });

    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
