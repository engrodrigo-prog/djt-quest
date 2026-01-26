// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { extractSepbookMentions } from "./sepbook-mentions.js";
import { localesForAllTargets, translateForumTexts } from "../server/lib/forum-translations.js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import { normalizeLatLng, reverseGeocodeCityLabel } from "../server/lib/reverse-geocode.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const normalizeTeamId = (raw: any) => String(raw || "").trim().toUpperCase();
const isGuestTeamId = (raw: any) => normalizeTeamId(raw) === "CONVIDADOS";
const isGuestProfile = (p: any) =>
  isGuestTeamId(p?.team_id) || isGuestTeamId(p?.sigla_area) || isGuestTeamId(p?.operational_base);
const isUuid = (value: any) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

const extractCampaignTitles = (md: string) => {
  const text = String(md || "");
  const out: string[] = [];
  for (const m of text.matchAll(/&"([^"]{2,160})"/g)) out.push(String(m[1] || "").trim());
  // Fallback for single-token titles without spaces/quotes
  for (const m of text.matchAll(/&([^\s#@&]{2,80})/g)) out.push(String(m[1] || "").trim());
  return Array.from(new Set(out.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, 3);
};

const cleanUrlForExt = (raw: string) => String(raw || "").split("?")[0].split("#")[0];
const isPhotoUrl = (url: string) => /\.(png|jpe?g|webp|gif|bmp|tif|tiff|heic|heif|avif)$/i.test(cleanUrlForExt(url));

const normalizeAttachmentUrl = (raw: any) => {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object") {
    if (typeof raw.url === "string") return raw.url.trim();
    if (typeof raw.publicUrl === "string") return raw.publicUrl.trim();
    if (typeof raw.href === "string") return raw.href.trim();
    if (typeof raw.src === "string") return raw.src.trim();
  }
  return String(raw || "").trim();
};

const extractAttachmentUrls = (attachments: any): string[] => {
  if (!attachments) return [];
  if (Array.isArray(attachments)) return attachments.map(normalizeAttachmentUrl).filter(Boolean);
  if (typeof attachments === "string") {
    const trimmed = attachments.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return extractAttachmentUrls(JSON.parse(trimmed));
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  if (typeof attachments === "object") {
    if (Array.isArray(attachments.urls)) return attachments.urls.map(normalizeAttachmentUrl).filter(Boolean);
    if (Array.isArray(attachments.items)) return attachments.items.map(normalizeAttachmentUrl).filter(Boolean);
    if (Array.isArray(attachments.files)) return attachments.files.map(normalizeAttachmentUrl).filter(Boolean);
  }
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
    } catch {
      // ignore (schema without mention_handle)
    }
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

async function syncPostMentions(params: {
  admin: any;
  postId: string;
  mentionedIds: string[];
  authorId: string;
  authorName: string;
}) {
  const { admin, postId, mentionedIds, authorId, authorName } = params;
  const clean = Array.from(new Set((mentionedIds || []).map((id) => String(id || "").trim()).filter(Boolean))).filter(
    (id) => id !== authorId,
  );

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

async function resolveCampaignByTitle(reader: any, titleRaw: string) {
  const title = String(titleRaw || "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  const safe = title.replace(/[%_]/g, "\\$&");
  // Try exact-ish match first
  const exact = await reader.from("campaigns").select("id,title,is_active,evidence_challenge_id").ilike("title", safe).limit(3);
  const exactRows = Array.isArray(exact?.data) ? exact.data : [];
  if (exactRows.length === 1) return exactRows[0];
  if (exactRows.length > 1) return { error: `Título de campanha ambíguo: "${title}"` };

  const like = await reader
    .from("campaigns")
    .select("id,title,is_active,evidence_challenge_id")
    .ilike("title", `%${safe}%`)
    .order("is_active", { ascending: false })
    .order("start_date", { ascending: false })
    .limit(5);
  const rows = Array.isArray(like?.data) ? like.data : [];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) return { error: `Mais de uma campanha encontrada para: "${title}". Seja mais específico.` };
  return null;
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

	    const {
	      content_md,
        post_kind,
	      attachments = [],
	      location_lat,
	      location_lng,
      locales,
      participant_ids,
      campaign_id,
      challenge_id,
      event_id,
      group_label,
      repost_of,
      sap_service_note,
	      transcript,
	      tags,
	      gps_meta,
	    } = req.body || {};
    const text = String(content_md || "").trim();
    const kind = String(post_kind || "").trim().toLowerCase() || "normal";
    const atts = Array.isArray(attachments) ? attachments : [];
    const repostOf = repost_of != null ? String(repost_of).trim() : "";
    if (!text && atts.length === 0 && !repostOf) return res.status(400).json({ error: "Conteúdo, mídia ou repost obrigatórios" });
    if (kind !== "normal" && kind !== "ocorrencia") return res.status(400).json({ error: "post_kind inválido" });

    // Campaign linking via &"Nome da Campanha" (one campaign per post)
    const extractedCampaignTitles = extractCampaignTitles(text);
    if (extractedCampaignTitles.length > 1) {
      return res.status(400).json({
        error: "A publicação deve referenciar apenas 1 campanha via &\"Nome\". Remova campanhas extras.",
      });
    }

	    const participantIds = Array.isArray(participant_ids)
	      ? Array.from(new Set((participant_ids as string[]).filter((id) => typeof id === "string" && id.trim().length > 0)))
	      : [];

	    const { data: profile } = await authed
	      .from("profiles")
	      .select("name, sigla_area, avatar_url, operational_base, team_id")
	      .eq("id", uid)
	      .maybeSingle();

	    const cleanSap = typeof sap_service_note === "string" ? sap_service_note.trim().slice(0, 120) : "";
	    const cleanTranscript = typeof transcript === "string" ? transcript.trim().slice(0, 12000) : "";
    const cleanTags = Array.isArray(tags)
      ? Array.from(
          new Set(
            (tags as any[])
              .map((t) => String(t || "").trim())
              .filter(Boolean)
              .map((t) => t.replace(/^#+/, "").slice(0, 40)),
          ),
        ).slice(0, 10)
      : [];
    const cleanGpsMeta = Array.isArray(gps_meta) ? gps_meta.slice(0, 8) : null;
    const eventIdClean = isUuid(event_id) ? String(event_id).trim() : "";

	    let authorIsGuest = isGuestProfile(profile);
	    try {
	      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
	      if (Array.isArray(roles) && roles.some((r: any) => String(r?.role || "") === "invited")) authorIsGuest = true;
	    } catch {}

	    // Participants rules:
	    // - Guest cannot mark others (participants must be only self => empty list from API perspective).
	    // - Non-guest cannot mark guests (they never appear in picker, but validate server-side).
	    const participantIdsNoSelf = participantIds.filter((id) => String(id) !== String(uid));
	    if (authorIsGuest && participantIdsNoSelf.length > 0) {
	      return res.status(400).json({ error: "Convidado não pode marcar outros usuários. Envie a evidência apenas com você." });
	    }
	    if (!authorIsGuest && participantIdsNoSelf.length > 0) {
	      try {
	        const { data: participantProfiles } = await admin
	          .from("profiles")
	          .select("id,team_id,sigla_area,operational_base")
	          .in("id", participantIdsNoSelf)
	          .limit(2000);
	        const guestIds = (Array.isArray(participantProfiles) ? participantProfiles : [])
	          .filter((p: any) => isGuestProfile(p))
	          .map((p: any) => String(p.id));
	        if (guestIds.length > 0) {
	          return res.status(400).json({ error: "Convidados não podem ser marcados como participantes." });
	        }
	      } catch {
	        // best-effort: if validation fails, keep going (RLS/DB will still enforce if configured)
	      }
	    }

	    const safeParticipantIds = participantIdsNoSelf;

	    const targetLocales = localesForAllTargets(locales);
	    let translations: any = { "pt-BR": text || "" };
    if (text) {
      try {
        const [map] = await translateForumTexts({ texts: [text], targetLocales, maxPerBatch: 6 } as any);
        if (map && typeof map === "object") translations = map;
      } catch {
        // keep base locale only
      }
    }

    let coords = normalizeLatLng(location_lat, location_lng);

    // Fallback 1: pick the first valid lat/lng from gps_meta (client can send EXIF/device points per attachment).
    if (!coords && Array.isArray(cleanGpsMeta) && cleanGpsMeta.length > 0) {
      try {
        for (const item of cleanGpsMeta) {
          const c = normalizeLatLng((item as any)?.lat, (item as any)?.lng);
          if (c) {
            coords = c;
            break;
          }
        }
      } catch {}
    }

    const computedLocationLabel = coords ? await reverseGeocodeCityLabel(coords.lat, coords.lng) : null;

    // Resolve campaign by explicit campaign_id or by &"Nome"
    let resolvedCampaignId = campaign_id || null;
    let evidenceChallengeId: string | null = null;
    try {
      if (!resolvedCampaignId && extractedCampaignTitles.length === 1) {
        const candidate = await resolveCampaignByTitle(SERVICE_ROLE_KEY ? admin : authed, extractedCampaignTitles[0]);
        if (candidate?.error) throw new Error(candidate.error);
        if (candidate?.id) {
          resolvedCampaignId = candidate.id;
          evidenceChallengeId = candidate.evidence_challenge_id || null;
        }
      } else if (resolvedCampaignId) {
        const { data: camp } = await (SERVICE_ROLE_KEY ? admin : authed)
          .from("campaigns")
          .select("id,evidence_challenge_id")
          .eq("id", resolvedCampaignId)
          .maybeSingle();
        evidenceChallengeId = (camp as any)?.evidence_challenge_id || null;
      }
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Falha ao resolver campanha via &\"Nome\"" });
    }

    const insertPayload: any = {
      user_id: uid,
      content_md: text,
      attachments: atts,
      has_media: atts.length > 0,
      post_kind: kind,
      repost_of: repostOf || null,
      location_label: computedLocationLabel,
      location_lat: coords ? coords.lat : null,
      location_lng: coords ? coords.lng : null,
      campaign_id: resolvedCampaignId || null,
      challenge_id: challenge_id || null,
      group_label: group_label || null,
      translations,
    };

    let post: any = null;
    let error: any = null;
    try {
      const resp = await authed.from("sepbook_posts").insert(insertPayload).select().single();
      post = resp.data;
      error = resp.error;
      if (error && /column .*translations.* does not exist/i.test(String(error.message || ""))) throw error;
    } catch {
      const { translations: _omit, ...fallbackPayload } = insertPayload;
      const resp2 = await authed.from("sepbook_posts").insert(fallbackPayload).select().single();
      post = resp2.data;
      error = resp2.error;
    }

    if (error) {
      const message = error?.message || "Erro ao salvar postagem";
      if (message.toLowerCase().includes("sepbook_posts")) {
        return res
          .status(500)
          .json({ error: "Tabela sepbook_posts ausente. Aplique a migração supabase/migrations/20251115153000_sepbook.sql" });
      }
      if (message.toLowerCase().includes("row level security") || message.toLowerCase().includes("rls")) {
        return res.status(500).json({
          error:
            "RLS bloqueou a criação do post. Aplique a migração supabase/migrations/20251218190000_sepbook_rls_write_policies.sql (políticas de escrita do SEPBook).",
        });
      }
      return res.status(400).json({ error: message });
    }

    if (safeParticipantIds.length > 0) {
      try {
        const rows = safeParticipantIds.map((pid) => ({ post_id: post.id, user_id: pid }));
        await authed.from("sepbook_post_participants").insert(rows, { returning: "minimal" } as any);
      } catch {}
    }

    // XP por postagem no SEPBook: 5 XP por foto (imagens no campo attachments)
    try {
      const urls = extractAttachmentUrls(atts);
      const photoCount = urls.filter((u: any) => typeof u === "string" && isPhotoUrl(String(u))).length;
      const xpAmount = photoCount * 5;
      if (xpAmount > 0) {
        await authed.rpc("increment_user_xp", { _user_id: uid, _xp_to_add: xpAmount });
      }
    } catch {}

    // Criar evento/evidência se a publicação estiver vinculada a uma campanha/desafio ou tiver participantes
    let eventId: string | null = null;
    let eventError: string | null = null;
    try {
      if (eventIdClean) {
        eventId = eventIdClean;
        try {
          await (SERVICE_ROLE_KEY ? admin : authed)
            .from("sepbook_posts")
            .update({ event_id: eventId } as any)
            .eq("id", post.id);
        } catch {}
        try {
          const { data: ev } = await (SERVICE_ROLE_KEY ? admin : authed)
            .from("events")
            .select("id,user_id,payload,evidence_urls")
            .eq("id", eventId)
            .maybeSingle();
          if (ev && String(ev.user_id) === String(uid)) {
            const nextPayload = {
              ...(ev.payload && typeof ev.payload === "object" ? ev.payload : {}),
              sepbook_post_id: post.id,
              publish_sepbook: true,
            };
            await (SERVICE_ROLE_KEY ? admin : authed)
              .from("events")
              .update({
                payload: nextPayload,
                evidence_urls: Array.isArray(ev.evidence_urls) && ev.evidence_urls.length ? ev.evidence_urls : atts,
              })
              .eq("id", eventId);
          }
        } catch {}
      } else {
        const nextChallengeId = challenge_id || evidenceChallengeId || null;
        if (resolvedCampaignId || nextChallengeId || safeParticipantIds.length > 0) {
          // Em ambientes sem service role, essa integração é best-effort.
          const writer = SERVICE_ROLE_KEY ? admin : authed;
          const payload = {
            source: "sepbook",
            sepbook_post_id: post.id,
            content_md: text,
            attachments: atts,
            campaign_id: resolvedCampaignId || null,
            group_label: group_label || null,
            location_label: computedLocationLabel,
            location_lat: coords ? coords.lat : null,
            location_lng: coords ? coords.lng : null,
            sap_service_note: cleanSap || null,
            transcript: cleanTranscript || null,
            tags: cleanTags,
            gps_meta: cleanGpsMeta,
            publish_sepbook: true,
          };

          const { data: newEvent, error: eventErr } = await writer
            .from("events")
            .insert({
              user_id: uid,
              challenge_id: nextChallengeId,
              status: "submitted",
              evidence_urls: atts,
              sap_service_note: cleanSap || null,
              payload,
            })
            .select("id")
            .single();

          if (eventErr) throw eventErr;
          eventId = newEvent?.id || null;

          // Upsert participantes (inclui sempre o autor)
          const participantsSet = new Set<string>(safeParticipantIds);
          participantsSet.add(uid);
          const participantRows = Array.from(participantsSet).map((pid) => ({ event_id: eventId, user_id: pid }));
          await writer.from("event_participants").upsert(participantRows as any, { onConflict: "event_id,user_id" } as any);

          // Persist back-reference on the post if the column exists (best-effort)
          try {
            await writer.from("sepbook_posts").update({ event_id: eventId } as any).eq("id", post.id);
          } catch {}
        }
      }
    } catch (e: any) {
      const msg = e?.message || "Falha ao criar evidência";
      eventError = msg;
      console.warn("SEPBook evidence->event error", msg);
    }

    // Atualizar menções com base no conteúdo do post (rápido; comentários têm tabela própria).
    try {
      if (!SERVICE_ROLE_KEY) throw new Error("no service role");
      const handles = extractSepbookMentions(text || "");
      if (handles.length) {
        const mentionedIds = await resolveMentionIds(admin, handles);
        await syncPostMentions({
          admin,
          postId: String(post.id),
          mentionedIds,
          authorId: uid,
          authorName: profile?.name || "Colaborador",
        });
      }
    } catch {}

    return res.status(200).json({
      success: true,
      post: {
        ...post,
        author_name: profile?.name || "Colaborador",
        author_team: profile?.sigla_area || null,
        author_avatar: profile?.avatar_url || null,
        author_base: (profile as any)?.operational_base || null,
      },
      event_id: eventId,
      event_error: eventError,
    });
  } catch (e: any) {
    const message = e?.message || "Unknown error";
    // Erro comum: tabelas ausentes
    if (typeof message === "string" && message.toLowerCase().includes("sepbook_posts")) {
      return res
        .status(500)
        .json({ error: "Tabela sepbook_posts ausente. Aplique a migração supabase/migrations/20251115153000_sepbook.sql" });
    }
    return res.status(500).json({ error: message });
  }
}

export const config = { api: { bodyParser: true }, maxDuration: 60 };
