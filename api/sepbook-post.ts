// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { recomputeSepbookMentionsForPost } from "./sepbook-mentions.js";
import { localesForAllTargets, translateForumTexts } from "../server/lib/forum-translations.js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

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
	      attachments = [],
	      location_label,
	      location_lat,
	      location_lng,
	      locales,
	      participant_ids,
	      campaign_id,
	      challenge_id,
	      group_label,
	      repost_of,
	      sap_service_note,
	      transcript,
	      tags,
	      gps_meta,
	    } = req.body || {};
    const text = String(content_md || "").trim();
    const atts = Array.isArray(attachments) ? attachments : [];
    const repostOf = repost_of != null ? String(repost_of).trim() : "";
    if (!text && atts.length === 0 && !repostOf) return res.status(400).json({ error: "Conteúdo, mídia ou repost obrigatórios" });

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
      repost_of: repostOf || null,
      location_label: location_label || null,
      location_lat: typeof location_lat === "number" ? location_lat : null,
      location_lng: typeof location_lng === "number" ? location_lng : null,
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
          location_label: location_label || null,
          location_lat: typeof location_lat === "number" ? location_lat : null,
          location_lng: typeof location_lng === "number" ? location_lng : null,
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
    } catch (e: any) {
      const msg = e?.message || "Falha ao criar evidência";
      eventError = msg;
      console.warn("SEPBook evidence->event error", msg);
    }

    // Atualizar menções com base no conteúdo (post + comentários)
    try {
      if (!SERVICE_ROLE_KEY) throw new Error("no service role");
      await recomputeSepbookMentionsForPost(post.id);
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

export const config = { api: { bodyParser: true } };
