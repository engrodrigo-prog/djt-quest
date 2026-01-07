// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { recomputeSepbookMentionsForPost } from "./sepbook-mentions.js";
import { assertDjtQuestServerEnv, DJT_QUEST_SUPABASE_HOST } from "../server/env-guard.js";
import { getSupabaseUrlFromEnv } from "../server/lib/supabase-url.js";
import { localesForAllTargets, translateForumTexts } from "../server/lib/forum-translations.js";

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
      const baseSelect = "id, post_id, user_id, content_md, created_at, parent_id, updated_at";
      const selectWithAttachments = `${baseSelect}, attachments, translations`;
      let data: any[] | null = null;
      let error: any = null;
      const attempt = await reader
        .from("sepbook_comments")
        .select(selectWithAttachments)
        .eq("post_id", postId)
        .order("created_at", { ascending: true })
        .limit(100);
      data = attempt.data as any;
      error = attempt.error as any;
      if (error && /attachments|translations|parent_id|updated_at/i.test(String(error.message || ""))) {
        const fallback = await reader
          .from("sepbook_comments")
          .select("id, post_id, user_id, content_md, created_at")
          .eq("post_id", postId)
          .order("created_at", { ascending: true })
          .limit(100);
        data = fallback.data as any;
        error = fallback.error as any;
      }
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

      let uid: string | null = null;
      if (token && (SERVICE_ROLE_KEY || authed)) {
        try {
          const userData = SERVICE_ROLE_KEY ? await admin.auth.getUser(token) : await authed.auth.getUser();
          uid = userData?.data?.user?.id || null;
        } catch {
          uid = null;
        }
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

      const commentIds = (data || []).map((c) => c.id).filter(Boolean);
      let likes: any[] = [];
      try {
        if (commentIds.length) {
          const { data: likesRows } = await reader
            .from("sepbook_comment_likes")
            .select("comment_id, user_id")
            .in("comment_id", commentIds)
            .limit(2000);
          likes = (likesRows as any[]) || [];
        }
      } catch {
        likes = [];
      }
      const likeCounts = new Map<string, number>();
      const likedByUser = new Set<string>();
      for (const row of likes || []) {
        const cid = String(row?.comment_id || "");
        if (!cid) continue;
        likeCounts.set(cid, (likeCounts.get(cid) || 0) + 1);
        if (uid && row?.user_id === uid) likedByUser.add(cid);
      }

      const items = (data || []).map((c) => {
        const prof = profileMap.get(c.user_id) || { name: "Colaborador", sigla_area: null, avatar_url: null, operational_base: null };
        const attachments = Array.isArray(c.attachments) ? c.attachments.filter(Boolean) : [];
        const translations = c?.translations && typeof c.translations === "object" ? c.translations : null;
        return {
          id: c.id,
          post_id: c.post_id,
          user_id: c.user_id,
          parent_id: c?.parent_id || null,
          author_name: prof.name,
          author_team: prof.sigla_area,
          author_avatar: prof.avatar_url,
          author_base: prof.operational_base,
          content_md: c.content_md,
          attachments,
          translations,
          created_at: c.created_at,
          updated_at: c?.updated_at || null,
          like_count: likeCounts.get(String(c.id)) || 0,
          has_liked: likedByUser.has(String(c.id)),
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

      const { post_id, content_md, parent_id } = req.body || {};
      const rawAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
      const attachments = rawAttachments
        .filter((item: any) => typeof item === "string" && item.trim())
        .slice(0, 3);
      const targetLocales = localesForAllTargets(req.body?.locales);
      const postId = String(post_id || "").trim();
      const parentId = parent_id ? String(parent_id).trim() : null;
      const text = String(content_md || "").trim();
      if (!postId || (text.length < 2 && attachments.length === 0)) {
        return res.status(400).json({ error: "post_id e texto/foto obrigatórios" });
      }
      const normalizedText = text.length >= 2 ? text : "";

      let translations: any = { "pt-BR": normalizedText || "" };
      if (normalizedText) {
        try {
          const [map] = await translateForumTexts({ texts: [normalizedText], targetLocales, maxPerBatch: 6 } as any);
          if (map && typeof map === "object") translations = map;
        } catch {
          // keep base locale only
        }
      }

      const profileReader = SERVICE_ROLE_KEY ? admin : authed;
      if (parentId) {
        try {
          const { data: parent } = await profileReader
            .from("sepbook_comments")
            .select("id, post_id")
            .eq("id", parentId)
            .maybeSingle();
          if (!parent || String(parent.post_id || "") !== postId) {
            return res.status(400).json({ error: "parent_id inválido para este post" });
          }
        } catch {
          return res.status(400).json({ error: "parent_id inválido para este post" });
        }
      }
      const { data: profile } = await profileReader
        .from("profiles")
        .select("name, sigla_area")
        .eq("id", uid)
        .maybeSingle();

      const writer = SERVICE_ROLE_KEY ? admin : authed;
      const insertPayload: any = {
        post_id: postId,
        user_id: uid,
        content_md: normalizedText,
        attachments,
        translations,
        ...(parentId ? { parent_id: parentId } : {}),
      };

      let data: any = null;
      let error: any = null;
      try {
        const resp = await writer.from("sepbook_comments").insert(insertPayload).select().single();
        data = resp.data;
        error = resp.error;
        if (error && /column .*translations.* does not exist/i.test(String(error.message || ""))) throw error;
      } catch {
        const { translations: _omit, ...fallbackPayload } = insertPayload;
        const resp2 = await writer.from("sepbook_comments").insert(fallbackPayload).select().single();
        data = resp2.data;
        error = resp2.error;
      }
      if (error) {
        const message = error.message || "Falha ao comentar";
        if (/attachments/i.test(message) && /(column|schema cache|does not exist)/i.test(message)) {
          return res.status(400).json({
            error:
              "A coluna de anexos ainda não existe em sepbook_comments. Aplique a migração supabase/migrations/20251231180000_sepbook_comment_attachments.sql.",
          });
        }
        if (/translations/i.test(message) && /(column|schema cache|does not exist)/i.test(message)) {
          return res.status(400).json({
            error:
              "A coluna de traduções ainda não existe no SEPBook. Aplique a migração supabase/migrations/20260101130000_sepbook_translations.sql.",
          });
        }
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

      // XP por comentário no SEPBook (limitado a 100 XP/mês via função).
      try {
        if (SERVICE_ROLE_KEY) {
          await admin.rpc("increment_sepbook_profile_xp", { p_user_id: uid, p_amount: 2 });
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
          like_count: 0,
          has_liked: false,
        },
      });
    }

    if (req.method === "PATCH") {
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

      const { comment_id, content_md } = req.body || {};
      const commentId = String(comment_id || "").trim();
      if (!commentId) return res.status(400).json({ error: "comment_id obrigatório" });
      const rawAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : null;
      const nextAttachments = rawAttachments
        ? rawAttachments.filter((item: any) => typeof item === "string" && item.trim()).slice(0, 3)
        : null;
      const text = String(content_md || "").trim();
      const normalizedText = text.length >= 2 ? text : "";
      const targetLocales = localesForAllTargets(req.body?.locales);

      const reader = SERVICE_ROLE_KEY ? admin : authed;
      const { data: existing, error: fetchErr } = await reader
        .from("sepbook_comments")
        .select("id, post_id, user_id, attachments, translations, parent_id")
        .eq("id", commentId)
        .maybeSingle();
      if (fetchErr) return res.status(400).json({ error: fetchErr.message });
      if (!existing) return res.status(404).json({ error: "Comentário não encontrado" });
      if (existing.user_id !== uid) return res.status(403).json({ error: "Sem permissão para editar este comentário" });

      const effectiveAttachments = nextAttachments ?? (Array.isArray(existing.attachments) ? existing.attachments : []);
      if (normalizedText.length < 2 && effectiveAttachments.length === 0) {
        return res.status(400).json({ error: "Texto ou anexo obrigatório" });
      }

      let translations: any = existing?.translations && typeof existing.translations === "object" ? existing.translations : { "pt-BR": normalizedText || "" };
      if (normalizedText) {
        translations = { "pt-BR": normalizedText };
        try {
          const [map] = await translateForumTexts({ texts: [normalizedText], targetLocales, maxPerBatch: 6 } as any);
          if (map && typeof map === "object") translations = map;
        } catch {
          // keep base locale only
        }
      }

      let updateError: any = null;
      try {
        const { error } = await reader
          .from("sepbook_comments")
          .update({
            content_md: normalizedText,
            attachments: effectiveAttachments,
            translations,
          } as any)
          .eq("id", commentId);
        updateError = error;
        if (updateError && /column .*translations.* does not exist/i.test(String(updateError.message || ""))) throw updateError;
      } catch {
        const { error } = await reader
          .from("sepbook_comments")
          .update({
            content_md: normalizedText,
            attachments: effectiveAttachments,
          } as any)
          .eq("id", commentId);
        updateError = error;
      }
      if (updateError) return res.status(400).json({ error: updateError.message || "Falha ao atualizar comentário" });

      try {
        if (!SERVICE_ROLE_KEY) throw new Error("no service role");
        await recomputeSepbookMentionsForPost(existing.post_id);
      } catch {}

      let profile: any = null;
      try {
        const { data: profileData } = await reader
          .from("profiles")
          .select("name, sigla_area, avatar_url, operational_base")
          .eq("id", uid)
          .maybeSingle();
        profile = profileData || null;
      } catch {
        profile = null;
      }

      return res.status(200).json({
        success: true,
        comment: {
          id: existing.id,
          post_id: existing.post_id,
          user_id: uid,
          parent_id: existing.parent_id || null,
          content_md: normalizedText,
          attachments: effectiveAttachments,
          translations,
          author_name: profile?.name || "Colaborador",
          author_team: profile?.sigla_area || null,
          author_avatar: profile?.avatar_url || null,
          author_base: profile?.operational_base || null,
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
