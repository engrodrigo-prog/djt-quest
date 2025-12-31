// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { recomputeSepbookMentionsForPost } from "./sepbook-mentions.js";
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
const ENV_INFO = {
  hasSupabaseUrl: Boolean(SUPABASE_URL),
  supabaseHost: (() => {
    if (!SUPABASE_URL) return null;
    try {
      return new URL(SUPABASE_URL).hostname;
    } catch {
      return "invalid";
    }
  })(),
  hasServiceRoleKey: Boolean(SERVICE_ROLE_KEY),
  serviceRoleKeyLen: SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY.length : 0,
  hasAnonKey: Boolean(ANON_KEY),
  anonKeyLen: ANON_KEY ? ANON_KEY.length : 0,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    let admin: any = null;
    try {
      admin = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    } catch (e: any) {
      console.error("sepbook-comments: createClient failed", { message: e?.message || e, env: ENV_INFO });
      return res.status(500).json({ error: "Supabase client init failed" });
    }
    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const authed =
      token && ANON_KEY
        ? createClient(SUPABASE_URL, ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
        : null;

    if (req.method === "GET") {
      const postId = String(req.query.post_id || "").trim();
      if (!postId) return res.status(400).json({ error: "post_id required" });
      if (!SERVICE_ROLE_KEY && !authed) return res.status(401).json({ error: "Unauthorized" });

      const reader = SERVICE_ROLE_KEY ? admin : authed;
      const { data, error } = await reader
        .from("sepbook_comments")
        .select("id, post_id, user_id, content_md, created_at")
        .eq("post_id", postId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) {
        const msg = String(error.message || "");
        if (/(row level security|rls|permission denied|not authorized)/i.test(msg)) {
          return res.status(403).json({
            error:
              "Permissão insuficiente para ler comentários (RLS). Configure políticas de leitura no Supabase ou defina SUPABASE_SERVICE_ROLE_KEY no Vercel.",
          });
        }
        return res.status(400).json({ error: error.message });
      }

      const userIds = Array.from(new Set((data || []).map((c) => c.user_id)));
      let profiles: any[] = [];
      try {
        const profResp = await reader
          .from("profiles")
          .select("id, name, sigla_area, avatar_url, operational_base")
          .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
        profiles = (profResp.data as any[]) || [];
      } catch {
        profiles = [];
      }

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
      if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
      let uid: string | null = null;
      if (SERVICE_ROLE_KEY) {
        try {
          const { data: userData, error: authErr } = await admin.auth.getUser(token);
          if (!authErr) uid = userData?.user?.id || null;
        } catch {
          uid = null;
        }
      } else if (authed) {
        const { data: userData, error: authErr } = await authed.auth.getUser();
        if (authErr) return res.status(401).json({ error: "Unauthorized" });
        uid = userData?.user?.id || null;
      } else {
        return res.status(500).json({ error: "Missing Supabase anon key" });
      }
      if (!uid) return res.status(401).json({ error: "Unauthorized" });

      const { post_id, content_md } = req.body || {};
      const postId = String(post_id || "").trim();
      const text = String(content_md || "").trim();
      if (!postId || text.length < 2) return res.status(400).json({ error: "post_id e texto obrigatórios" });

      const profileReader = SERVICE_ROLE_KEY ? admin : authed;
      const { data: profile } = await profileReader
        .from("profiles")
        .select("name, sigla_area")
        .eq("id", uid)
        .maybeSingle();

      const writer = SERVICE_ROLE_KEY ? admin : authed;
      const { data, error } = await writer
        .from("sepbook_comments")
        .insert({
          post_id: postId,
          user_id: uid,
          content_md: text,
        })
        .select()
        .single();
      if (error) {
        const message = error.message || "Falha ao comentar";
        if (message.toLowerCase().includes("row level security") || message.toLowerCase().includes("rls")) {
          return res.status(403).json({
            error:
              "RLS bloqueou a criação do comentário. Aplique a migração supabase/migrations/20251218190000_sepbook_rls_write_policies.sql.",
          });
        }
        return res.status(400).json({ error: message });
      }

      // Atualizar contagem de comentários no post
      try {
        if (SERVICE_ROLE_KEY) {
          await admin.rpc("increment_sepbook_comment_count", { p_post_id: postId });
        }
      } catch {
        // fallback: set count by query
        try {
          const { count } = await authed
            .from("sepbook_comments")
            .select("id", { count: "exact", head: true })
            .eq("post_id", postId);
          if (SERVICE_ROLE_KEY) {
            await admin.from("sepbook_posts").update({ comment_count: count || 0 }).eq("id", postId);
          }
        } catch {}
      }

      // XP extra para comentários mais ricos: >30 chars, com # e @ (limitado a 100 XP/mês no SEPBook)
      try {
        const normalized = text || "";
        if (
          normalized.length >= 30 &&
          normalized.includes("#") &&
          /@[A-Za-z0-9_.-]+/.test(normalized)
        ) {
          await admin.rpc("increment_sepbook_profile_xp", { p_user_id: uid, p_amount: 1 });
        }
      } catch {}

      // Recalcular menções para o post considerando este novo comentário
      try {
        if (!SERVICE_ROLE_KEY) throw new Error("no service role");
        await recomputeSepbookMentionsForPost(postId);
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
    console.error("sepbook-comments: unhandled error", {
      message: e?.message || e,
      stack: e?.stack,
      env: ENV_INFO,
      method: req.method,
      hasAuthHeader: Boolean(req.headers?.authorization),
    });
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
