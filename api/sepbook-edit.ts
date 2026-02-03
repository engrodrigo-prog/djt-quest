// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { extractSepbookMentions } from "./sepbook-mentions.js";
import { translateForumTexts } from "../server/lib/forum-translations.js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import { normalizeLatLng, reverseGeocodeCityLabel } from "../server/lib/reverse-geocode.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;
const MOD_ROLES = new Set(["admin", "gerente_djt", "gerente_divisao_djtx", "coordenador_djtx"]);

const normalizeRequestedLocales = (raw: any) => {
  if (!raw) return [];
  if (typeof raw === "string") return raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (Array.isArray(raw)) return raw.map((v) => String(v || "").trim()).filter(Boolean);
  return [];
};

async function resolveMentionIds(admin: any, mentions: string[]) {
  const list = Array.from(new Set((mentions || []).map((m) => String(m || "").trim()).filter(Boolean))).slice(0, 60);
  const emailMentions = Array.from(new Set(list.filter((m) => m.includes("@")).map((m) => m.toLowerCase())));
  const handleMentions = Array.from(new Set(list.filter((m) => !m.includes("@")).map((m) => m.toLowerCase())));
  const teamMentions = Array.from(new Set(list.filter((m) => !m.includes("@")).map((m) => m.toUpperCase())));

  const ids = new Set<string>();

  if (emailMentions.length) {
    const { data: usersByEmail } = await admin.from("profiles").select("id, email").in("email", emailMentions);
    (usersByEmail || []).forEach((u: any) => u?.id && ids.add(String(u.id)));
  }

  if (handleMentions.length) {
    try {
      const { data: usersByHandle } = await admin.from("profiles").select("id, mention_handle").in("mention_handle", handleMentions);
      (usersByHandle || []).forEach((u: any) => u?.id && ids.add(String(u.id)));
    } catch {}
  }

  const baseTeams = new Set(["DJT", "DJTB", "DJTV"]);
  const baseRequested = teamMentions.filter((t) => baseTeams.has(t));
  const exactTeams = teamMentions.filter((t) => !baseTeams.has(t));

  if (exactTeams.length) {
    try {
      const { data: exactProfiles } = await admin.from("profiles").select("id, sigla_area").in("sigla_area", exactTeams);
      (exactProfiles || []).forEach((u: any) => u?.id && ids.add(String(u.id)));
    } catch {}
  }

  for (const base of baseRequested) {
    try {
      const { data: teamProfiles } = await admin
        .from("profiles")
        .select("id, sigla_area")
        .or(`sigla_area.eq.${base},sigla_area.ilike.${base}-%`);
      (teamProfiles || []).forEach((u: any) => u?.id && ids.add(String(u.id)));
    } catch {}
  }

  return Array.from(ids);
}

async function syncPostMentions(params: { admin: any; postId: string; mentionedIds: string[]; authorId: string; authorName: string }) {
  const { admin, postId, mentionedIds, authorId, authorName } = params;
  const clean = Array.from(new Set((mentionedIds || []).map((id) => String(id || "").trim()).filter(Boolean))).filter((id) => id !== authorId);

  let existing: string[] = [];
  try {
    const { data } = await admin.from("sepbook_mentions").select("mentioned_user_id").eq("post_id", postId);
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
      await admin.from("sepbook_mentions").delete().eq("post_id", postId).in("mentioned_user_id", toDelete);
    } catch {}
  }
  if (toInsert.length) {
    try {
      await admin.from("sepbook_mentions").insert(
        toInsert.map((uid: string) => ({ post_id: postId, mentioned_user_id: uid, is_read: false })) as any,
      );
    } catch {}
  }

  if (toInsert.length) {
    const message = `${String(authorName || "Alguém")} mencionou você em uma publicação.`;
    const metadata = { post_id: postId, mentioned_by: authorId };
    const chunks: string[][] = [];
    for (let i = 0; i < toInsert.length; i += 200) chunks.push(toInsert.slice(i, i + 200));
    try {
      for (const chunk of chunks) {
        await admin.rpc("create_notifications_bulk", {
          _user_ids: chunk,
          _type: "sepbook_mention",
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
            _type: "sepbook_mention",
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.slice(7);
    const authed = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: userData, error: authErr } = await authed.auth.getUser();
    if (authErr) return res.status(401).json({ error: "Unauthorized" });
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    let isMod = false;
    if (SERVICE_ROLE_KEY) {
      const { data: rolesRows } = await admin.from("user_roles").select("role").eq("user_id", uid);
      const roles = (rolesRows || []).map((r: any) => r.role as string);
      isMod = roles.some((r) => MOD_ROLES.has(r));
    }

    const body = req.body || {};
    const { post_id, content_md, attachments, post_kind, location_lat, location_lng } = body;
    const targetLocales = normalizeRequestedLocales(body?.locales);
    const postId = String(post_id || "").trim();
    const hasContentField = Object.prototype.hasOwnProperty.call(body, "content_md");
    const hasAttachmentsField = Object.prototype.hasOwnProperty.call(body, "attachments");
    const hasKindField = Object.prototype.hasOwnProperty.call(body, "post_kind");
    const hasLocationField =
      Object.prototype.hasOwnProperty.call(body, "location_lat") || Object.prototype.hasOwnProperty.call(body, "location_lng");

    const text = hasContentField ? String(content_md || "").trim() : null;
    const atts = hasAttachmentsField ? (Array.isArray(attachments) ? attachments : []) : null;
    const kindRaw = String(post_kind || "").trim();
    const kind = kindRaw ? kindRaw.toLowerCase() : "";

    if (!postId) return res.status(400).json({ error: "post_id required" });
    if (hasKindField && kind && kind !== "normal" && kind !== "ocorrencia") return res.status(400).json({ error: "post_kind inválido" });

    const { data: post, error: postErr } = await authed
      .from("sepbook_posts")
      .select("id, user_id, content_md, attachments")
      .eq("id", postId)
      .maybeSingle();
    if (postErr) return res.status(400).json({ error: postErr.message });
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    // Permitir edição apenas do autor ou moderadores
    if (post.user_id !== uid && !isMod) {
      return res.status(403).json({ error: "Sem permissão para editar este post" });
    }

    // location update (optional)
    let locationUpdate: any = null;
    if (hasLocationField) {
      const coords = normalizeLatLng(location_lat, location_lng);
      // allow explicit clear: both null/undefined clears location
      const wantsClear = (location_lat == null && location_lng == null);
      if (!coords && !wantsClear) return res.status(400).json({ error: "Localização inválida" });

      if (!isMod) {
        // Require explicit consent for non-mods
        try {
          const { data: prof } = await admin.from("profiles").select("sepbook_gps_consent").eq("id", uid).maybeSingle();
          if (prof?.sepbook_gps_consent !== true) return res.status(403).json({ error: "GPS não autorizado no SEPBook" });
        } catch {
          return res.status(403).json({ error: "GPS não autorizado no SEPBook" });
        }
      }
      const label = coords ? await reverseGeocodeCityLabel(coords.lat, coords.lng) : null;
      locationUpdate = {
        location_lat: coords ? coords.lat : null,
        location_lng: coords ? coords.lng : null,
        location_label: label,
      };
    }

    // Only translate if content is being updated.
    let translations: any = null;
    if (hasContentField) {
      translations = { "pt-BR": text || "" };
      if (text && targetLocales.length) {
        try {
          const [map] = await translateForumTexts({ texts: [text], targetLocales, maxPerBatch: 6 } as any);
          if (map && typeof map === "object") translations = map;
        } catch {
          // keep base locale only
        }
      }
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };
    if (hasContentField) updatePayload.content_md = text || "";
    if (hasAttachmentsField) {
      updatePayload.attachments = atts;
      updatePayload.has_media = (atts || []).length > 0;
    }
    if (translations) updatePayload.translations = translations;
    if (hasKindField && kind) updatePayload.post_kind = kind;
    if (locationUpdate) Object.assign(updatePayload, locationUpdate);

    if (Object.keys(updatePayload).length <= 1) {
      // Only updated_at
      return res.status(400).json({ error: "Nada para atualizar" });
    }

    // Prevent blank posts when content/attachments are being modified.
    if (hasContentField || hasAttachmentsField) {
      const nextText = hasContentField ? (text || "") : String(post?.content_md || "");
      const nextAtts = hasAttachmentsField ? (atts || []) : Array.isArray((post as any)?.attachments) ? (post as any).attachments : [];
      if (!String(nextText || "").trim() && (!Array.isArray(nextAtts) || nextAtts.length === 0)) {
        return res.status(400).json({ error: "Conteúdo ou mídia obrigatórios" });
      }
    }

    let data: any = null;
    let error: any = null;
    try {
      const resp = await authed.from("sepbook_posts").update(updatePayload as any).eq("id", postId).select().single();
      data = resp.data;
      error = resp.error;
      if (error && /column .*translations.* does not exist/i.test(String(error.message || ""))) throw error;
    } catch {
      const { translations: _omit, ...fallbackPayload } = updatePayload;
      const resp2 = await authed.from("sepbook_posts").update(fallbackPayload as any).eq("id", postId).select().single();
      data = resp2.data;
      error = resp2.error;
    }
    if (error) return res.status(400).json({ error: error.message });

    if (hasContentField) {
      try {
        if (!SERVICE_ROLE_KEY) throw new Error("no service role");
        const handles = extractSepbookMentions(text || "");
        if (handles.length) {
          const mentionedIds = await resolveMentionIds(admin, handles);
          await syncPostMentions({ admin, postId, mentionedIds, authorId: uid, authorName: "Colaborador" });
        } else {
          await admin.from("sepbook_mentions").delete().eq("post_id", postId);
        }
      } catch {}
    }

    return res.status(200).json({ success: true, post: data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
