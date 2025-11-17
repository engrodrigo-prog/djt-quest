// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (req.method === "GET") {
      const postId = String(req.query.post_id || "").trim();
      if (!postId) return res.status(400).json({ error: "post_id required" });

      const { data, error } = await admin
        .from("sepbook_comments")
        .select("id, post_id, user_id, content_md, created_at")
        .eq("post_id", postId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) return res.status(400).json({ error: error.message });

      const userIds = Array.from(new Set((data || []).map((c) => c.user_id)));
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, name, sigla_area, avatar_url, operational_base")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

      const profileMap = new Map<string, { name: string; sigla_area: string | null; avatar_url: string | null; operational_base: string | null }>();
      (profiles || []).forEach((p) => {
        profileMap.set(p.id, { name: p.name, sigla_area: p.sigla_area, avatar_url: p.avatar_url, operational_base: (p as any).operational_base || null });
      });

      const items = (data || []).map((c) => {
        const prof = profileMap.get(c.user_id) || { name: "Colaborador", sigla_area: null, avatar_url: null, operational_base: null };
        return {
          id: c.id,
          post_id: c.post_id,
          user_id: c.user_id,
          author_name: prof.name,
          author_team: prof.sigla_area,
          author_avatar: prof.avatar_url,
          author_base: prof.operational_base,
          content_md: c.content_md,
          created_at: c.created_at,
        };
      });

      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      const authHeader = req.headers["authorization"] as string | undefined;
      if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      const token = authHeader.slice(7);
      const { data: userData } = await admin.auth.getUser(token);
      const uid = userData?.user?.id;
      if (!uid) return res.status(401).json({ error: "Unauthorized" });

      const { post_id, content_md } = req.body || {};
      const postId = String(post_id || "").trim();
      const text = String(content_md || "").trim();
      if (!postId || text.length < 2) return res.status(400).json({ error: "post_id e texto obrigatórios" });

      const { data: profile } = await admin
        .from("profiles")
        .select("name, sigla_area")
        .eq("id", uid)
        .maybeSingle();

      const { data, error } = await admin
        .from("sepbook_comments")
        .insert({
          post_id: postId,
          user_id: uid,
          content_md: text,
        })
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });

      // Atualizar contagem de comentários no post
      try {
        await admin.rpc("increment_sepbook_comment_count", { p_post_id: postId });
      } catch {
        // fallback: set count by query
        try {
          const { count } = await admin
            .from("sepbook_comments")
            .select("id", { count: "exact", head: true })
            .eq("post_id", postId);
          await admin.from("sepbook_posts").update({ comment_count: count || 0 }).eq("id", postId);
        } catch {}
      }

      // XP extra para comentários mais ricos: >30 chars, com # e @
      try {
        const normalized = text || "";
        if (
          normalized.length >= 30 &&
          normalized.includes("#") &&
          /@[A-Za-z0-9_.-]+/.test(normalized)
        ) {
          await admin.rpc("increment_profile_xp", { p_user_id: uid, p_amount: 1 });
        }
      } catch {}

      return res.status(200).json({
        success: true,
        comment: {
          ...data,
          author_name: profile?.name || "Colaborador",
          author_team: profile?.sigla_area || null,
        },
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
