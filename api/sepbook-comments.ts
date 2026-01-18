// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv, DJT_QUEST_SUPABASE_HOST } from "../server/env-guard.js";
import { getSupabaseUrlFromEnv } from "../server/lib/supabase-url.js";
import { localesForAllTargets, translateForumTexts } from "../server/lib/forum-translations.js";
import { reverseGeocodeCityLabel } from "../server/lib/reverse-geocode.js";

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

const clampLatLng = (latRaw: any, lngRaw: any) => {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9) return null;
  return { lat, lng };
};

const extractMentions = (md: string) => {
  const text = String(md || "");
  const hits = Array.from(text.matchAll(/@([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/g)).map((m) =>
    String(m[1] || "").trim(),
  );
  return Array.from(new Set(hits.filter(Boolean))).slice(0, 40);
};

async function resolveMentionedUserIds(admin: any, mentions: string[]) {
  const list = Array.from(new Set((mentions || []).map((m) => String(m || "").trim()).filter(Boolean))).slice(0, 60);
  const emailMentions = Array.from(new Set(list.filter((m) => m.includes("@")).map((m) => m.toLowerCase())));
  const handleMentions = Array.from(new Set(list.filter((m) => !m.includes("@")).map((m) => m.toLowerCase())));
  const teamMentions = Array.from(new Set(list.filter((m) => !m.includes("@")).map((m) => m.toUpperCase())));
  const ids = new Set<string>();

  if (emailMentions.length) {
    const { data } = await admin.from("profiles").select("id, email").in("email", emailMentions);
    (data || []).forEach((u: any) => u?.id && ids.add(String(u.id)));
  }

  if (handleMentions.length) {
    try {
      const { data } = await admin.from("profiles").select("id, mention_handle").in("mention_handle", handleMentions);
      (data || []).forEach((u: any) => u?.id && ids.add(String(u.id)));
    } catch {
      // ignore (schema without mention_handle)
    }
  }

  // Team mentions by sigla_area (ex.: DJT, DJTB-CUB, DJTV-VOR)
  const baseTeams = new Set(["DJT", "DJTB", "DJTV"]);
  const baseRequested = teamMentions.filter((t) => baseTeams.has(t));
  const exactTeams = teamMentions.filter((t) => !baseTeams.has(t));

  if (exactTeams.length) {
    try {
      const { data } = await admin.from("profiles").select("id, sigla_area").in("sigla_area", exactTeams);
      (data || []).forEach((u: any) => u?.id && ids.add(String(u.id)));
    } catch {}
  }

  for (const base of baseRequested) {
    try {
      const { data } = await admin
        .from("profiles")
        .select("id, sigla_area")
        .or(`sigla_area.eq.${base},sigla_area.ilike.${base}-%`);
      (data || []).forEach((u: any) => u?.id && ids.add(String(u.id)));
    } catch {}
  }

  return Array.from(ids);
}

async function syncCommentMentions(params: {
  admin: any;
  commentId: string;
  postId: string;
  mentionedIds: string[];
  authorId: string;
  authorName: string;
}) {
  const { admin, commentId, postId, mentionedIds, authorId, authorName } = params;
  const clean = Array.from(new Set((mentionedIds || []).map((id) => String(id || "").trim()).filter(Boolean))).filter((id) => id !== authorId);

  let existing: string[] = [];
  try {
    const { data } = await admin
      .from("sepbook_comment_mentions")
      .select("mentioned_user_id")
      .eq("comment_id", commentId);
    existing = (data || []).map((r: any) => String(r.mentioned_user_id));
  } catch {
    existing = [];
  }
  const existingSet = new Set(existing);
  const nextSet = new Set(clean);
  const toInsert = clean.filter((id) => !existingSet.has(id));
  const toDelete = existing.filter((id) => !nextSet.has(id));

  if (toDelete.length) {
    try {
      await admin.from("sepbook_comment_mentions").delete().eq("comment_id", commentId).in("mentioned_user_id", toDelete);
    } catch {}
  }
  if (toInsert.length) {
    try {
      await admin.from("sepbook_comment_mentions").insert(
        toInsert.map((uid: string) => ({
          comment_id: commentId,
          post_id: postId,
          mentioned_user_id: uid,
          is_read: false,
        })) as any,
      );
    } catch {}
  }

  // Notifications for newly mentioned users (best-effort, avoid duplicates by only notifying on insert)
  if (toInsert.length) {
    const message = `${String(authorName || "Alguém")} mencionou você em um comentário.`;
    const metadata = { post_id: postId, comment_id: commentId, mentioned_by: authorId };
    const chunks: string[][] = [];
    for (let i = 0; i < toInsert.length; i += 200) chunks.push(toInsert.slice(i, i + 200));
    try {
      for (const chunk of chunks) {
        await admin.rpc("create_notifications_bulk", {
          _user_ids: chunk,
          _type: "sepbook_comment_mention",
          _title: "Você foi mencionado no SEPBook",
          _message: message,
          _metadata: metadata,
        });
      }
    } catch {
      for (const uid of toInsert) {
        try {
          await admin.rpc("create_notification", {
            _user_id: uid,
            _type: "sepbook_comment_mention",
            _title: "Você foi mencionado no SEPBook",
            _message: message,
            _metadata: metadata,
          });
        } catch {}
      }
    }
  }
}

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
      const baseSelect =
        "id, post_id, user_id, content_md, created_at, parent_id, updated_at, location_label, location_lat, location_lng, deleted_at, deleted_by";
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
      if (
        error &&
        /attachments|translations|parent_id|updated_at|location_lat|location_lng|location_label|deleted_at|deleted_by/i.test(
          String(error.message || ""),
        )
      ) {
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
          location_label: typeof c?.location_label === "string" ? c.location_label : null,
          location_lat: typeof c?.location_lat === "number" ? c.location_lat : null,
          location_lng: typeof c?.location_lng === "number" ? c.location_lng : null,
          created_at: c.created_at,
          updated_at: c?.updated_at || null,
          deleted_at: c?.deleted_at || null,
          deleted_by: c?.deleted_by || null,
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
      const maybeCoords = clampLatLng(req.body?.location_lat, req.body?.location_lng);
      const locationLabel = maybeCoords ? await reverseGeocodeCityLabel(maybeCoords.lat, maybeCoords.lng) : null;
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
        ...(maybeCoords ? { location_lat: maybeCoords.lat, location_lng: maybeCoords.lng, location_label: locationLabel } : {}),
      };

      let data: any = null;
      let error: any = null;
      try {
        const resp = await writer.from("sepbook_comments").insert(insertPayload).select().single();
        data = resp.data;
        error = resp.error;
        if (error && /column .*translations.* does not exist/i.test(String(error.message || ""))) throw error;
        if (
          error &&
          /location_(lat|lng|label)/i.test(String(error.message || "")) &&
          /(column|schema cache|does not exist)/i.test(String(error.message || ""))
        ) {
          throw error;
        }
      } catch {
        const { translations: _omit, location_label: _l1, location_lat: _l2, location_lng: _l3, ...fallbackPayload } = insertPayload;
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
      // comment_count is maintained by DB trigger (sepbook_count_triggers); keep API fast.

      // XP por comentário no SEPBook (limitado a 100 XP/mês via função).
      try {
        await writer.rpc("increment_user_xp", { _user_id: uid, _xp_to_add: 2 });
      } catch {}

      try {
        if (!SERVICE_ROLE_KEY) throw new Error("no service role");
        const mentionedHandles = extractMentions(normalizedText);
        if (mentionedHandles.length) {
          const mentionedIds = await resolveMentionedUserIds(admin, mentionedHandles);
          await syncCommentMentions({
            admin,
            commentId: String(data.id),
            postId,
            mentionedIds,
            authorId: uid,
            authorName: profile?.name || "Colaborador",
          });
        }
      } catch {}

      return res.status(200).json({
        success: true,
        comment: {
          ...data,
          author_name: profile?.name || "Colaborador",
          author_team: profile?.sigla_area || null,
          location_label: maybeCoords ? locationLabel : (data as any)?.location_label || null,
          location_lat: maybeCoords ? maybeCoords.lat : (data as any)?.location_lat || null,
          location_lng: maybeCoords ? maybeCoords.lng : (data as any)?.location_lng || null,
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
      const restore = Boolean(req.body?.restore);
      const commentId = String(comment_id || "").trim();
      if (!commentId) return res.status(400).json({ error: "comment_id obrigatório" });
      const rawAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : null;
      const nextAttachments = rawAttachments
        ? rawAttachments.filter((item: any) => typeof item === "string" && item.trim()).slice(0, 3)
        : null;
      const maybeCoords = clampLatLng(req.body?.location_lat, req.body?.location_lng);
      const locationLabel = maybeCoords ? await reverseGeocodeCityLabel(maybeCoords.lat, maybeCoords.lng) : null;
      const text = String(content_md || "").trim();
      const normalizedText = text.length >= 2 ? text : "";
      const targetLocales = localesForAllTargets(req.body?.locales);

      const reader = SERVICE_ROLE_KEY ? admin : authed;
      const { data: existing, error: fetchErr } = await reader
        .from("sepbook_comments")
        .select(
          "id, post_id, user_id, attachments, translations, parent_id, location_label, location_lat, location_lng, deleted_at, deleted_by, deleted_backup",
        )
        .eq("id", commentId)
        .maybeSingle();
      if (fetchErr) return res.status(400).json({ error: fetchErr.message });
      if (!existing) return res.status(404).json({ error: "Comentário não encontrado" });
      if (existing.user_id !== uid) return res.status(403).json({ error: "Sem permissão para editar este comentário" });

      if (restore) {
        const backup = (existing as any)?.deleted_backup && typeof (existing as any).deleted_backup === "object" ? (existing as any).deleted_backup : null;
        if (!backup) return res.status(400).json({ error: "Nada para restaurar" });
        const restoreText = String(backup?.content_md || "").trim();
        const restoreAttachments = Array.isArray(backup?.attachments) ? backup.attachments : [];
        const restoreTranslations = backup?.translations && typeof backup.translations === "object" ? backup.translations : null;
        const patch: any = {
          content_md: restoreText,
          attachments: restoreAttachments,
          translations: restoreTranslations,
          updated_at: new Date().toISOString(),
          deleted_at: null,
          deleted_by: null,
          deleted_backup: null,
        };
        const { error } = await reader.from("sepbook_comments").update(patch as any).eq("id", commentId);
        if (error) return res.status(400).json({ error: error.message || "Falha ao restaurar comentário" });
        return res.status(200).json({
          success: true,
          comment: {
            id: existing.id,
            post_id: existing.post_id,
            user_id: existing.user_id,
            parent_id: existing.parent_id || null,
            content_md: restoreText,
            attachments: restoreAttachments,
            translations: restoreTranslations,
            location_label: (existing as any)?.location_label || null,
            location_lat: (existing as any)?.location_lat || null,
            location_lng: (existing as any)?.location_lng || null,
            deleted_at: null,
            deleted_by: null,
            updated_at: patch.updated_at,
          },
        });
      }

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
      const locationPatch = maybeCoords
          ? { location_lat: maybeCoords.lat, location_lng: maybeCoords.lng, location_label: locationLabel }
          : {};
        const { error } = await reader
          .from("sepbook_comments")
          .update({
            content_md: normalizedText,
            attachments: effectiveAttachments,
            translations,
            ...locationPatch,
            deleted_at: null,
            deleted_by: null,
            deleted_backup: null,
          } as any)
          .eq("id", commentId);
        updateError = error;
        if (updateError && /column .*translations.* does not exist/i.test(String(updateError.message || ""))) throw updateError;
        if (
          updateError &&
          /location_(lat|lng|label)/i.test(String(updateError.message || "")) &&
          /(column|schema cache|does not exist)/i.test(String(updateError.message || ""))
        ) {
          throw updateError;
        }
        if (
          updateError &&
          /deleted_(at|by|backup)/i.test(String(updateError.message || "")) &&
          /(column|schema cache|does not exist)/i.test(String(updateError.message || ""))
        ) {
          throw updateError;
        }
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

      let mentionedIds: string[] = [];
      try {
        if (!SERVICE_ROLE_KEY) throw new Error("no service role");
        const mentionedHandles = extractMentions(normalizedText);
        mentionedIds = mentionedHandles.length ? await resolveMentionedUserIds(admin, mentionedHandles) : [];
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

      try {
        if (!SERVICE_ROLE_KEY) throw new Error("no service role");
        await syncCommentMentions({
          admin,
          commentId,
          postId: String(existing.post_id),
          mentionedIds,
          authorId: uid,
          authorName: profile?.name || "Colaborador",
        });
      } catch {}

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
          location_label: maybeCoords ? locationLabel : (existing as any)?.location_label || null,
          location_lat: maybeCoords ? maybeCoords.lat : (existing as any)?.location_lat || null,
          location_lng: maybeCoords ? maybeCoords.lng : (existing as any)?.location_lng || null,
          deleted_at: (existing as any)?.deleted_at || null,
          deleted_by: (existing as any)?.deleted_by || null,
          author_name: profile?.name || "Colaborador",
          author_team: profile?.sigla_area || null,
          author_avatar: profile?.avatar_url || null,
          author_base: profile?.operational_base || null,
        },
      });
    }

    if (req.method === "DELETE") {
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

      const commentId = String(req.query.comment_id || req.body?.comment_id || "").trim();
      if (!commentId) return res.status(400).json({ error: "comment_id obrigatório" });

      const reader = SERVICE_ROLE_KEY ? admin : authed;
      const { data: existing, error: fetchErr } = await reader
        .from("sepbook_comments")
        .select("id, post_id, user_id, parent_id, attachments, translations, content_md, created_at, deleted_at, deleted_by, deleted_backup")
        .eq("id", commentId)
        .maybeSingle();
      if (fetchErr) return res.status(400).json({ error: fetchErr.message });
      if (!existing) return res.status(404).json({ error: "Comentário não encontrado" });
      if (existing.user_id !== uid) return res.status(403).json({ error: "Sem permissão para excluir este comentário" });

      // If the comment has replies, keep the thread and just clear the content.
      let hasReplies = false;
      try {
        const { data: replies } = await reader.from("sepbook_comments").select("id").eq("parent_id", commentId).limit(1);
        hasReplies = Boolean(replies && replies.length > 0);
      } catch {
        hasReplies = false;
      }

      const softDelete = async () => {
        // Best-effort cleanup (requires service role to remove others' likes).
        if (SERVICE_ROLE_KEY) {
          try {
            await admin.from("sepbook_comment_likes").delete().eq("comment_id", commentId);
          } catch {}
          try {
            await admin.from("sepbook_comment_mentions").delete().eq("comment_id", commentId);
          } catch {}
        }

        const effectiveAttachments: any[] = [];
        const translations: any = existing?.translations && typeof existing.translations === "object" ? existing.translations : null;
        const nextTranslations = translations ? { ...translations, "pt-BR": "" } : { "pt-BR": "" };
        const backup = {
          content_md: existing?.content_md || "",
          attachments: Array.isArray(existing?.attachments) ? existing.attachments : [],
          translations: translations,
        };
        try {
          const { error } = await reader
            .from("sepbook_comments")
            .update(
              {
                content_md: "",
                attachments: effectiveAttachments,
                translations: nextTranslations,
                deleted_at: new Date().toISOString(),
                deleted_by: uid,
                deleted_backup: backup,
              } as any,
            )
            .eq("id", commentId);
          if (error && /column .*translations.* does not exist/i.test(String(error.message || ""))) throw error;
          if (error && /deleted_(at|by|backup)/i.test(String(error.message || ""))) throw error;
          if (error) return { ok: false as const, error };
          return { ok: true as const };
        } catch {
          const { error } = await reader
            .from("sepbook_comments")
            .update({ content_md: "", attachments: effectiveAttachments } as any)
            .eq("id", commentId);
          if (error) return { ok: false as const, error };
          return { ok: true as const };
        }
      };

      const soft = await softDelete();
      if (!soft.ok) return res.status(400).json({ error: soft.error?.message || "Falha ao excluir comentário" });
      return res.status(200).json({ success: true, deleted: hasReplies ? "soft" : "soft_no_replies" });
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

export const config = { api: { bodyParser: true }, maxDuration: 60 };
