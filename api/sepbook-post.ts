// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { recomputeSepbookMentionsForPost } from "./sepbook-mentions";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.slice(7);
    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const {
      content_md,
      attachments = [],
      location_label,
      location_lat,
      location_lng,
      participant_ids,
      campaign_id,
      challenge_id,
      group_label,
    } = req.body || {};
    const text = String(content_md || "").trim();
    const atts = Array.isArray(attachments) ? attachments : [];
    if (!text && atts.length === 0) return res.status(400).json({ error: "Conteúdo ou mídia obrigatórios" });

    const participantIds = Array.isArray(participant_ids)
      ? Array.from(new Set((participant_ids as string[]).filter((id) => typeof id === "string" && id.trim().length > 0)))
      : [];

    const { data: profile } = await admin
      .from("profiles")
      .select("name, sigla_area, avatar_url, operational_base")
      .eq("id", uid)
      .maybeSingle();

    const { data: post, error } = await admin
      .from("sepbook_posts")
      .insert({
        user_id: uid,
        content_md: text,
        attachments: atts,
        has_media: atts.length > 0,
        location_label: location_label || null,
        location_lat: typeof location_lat === "number" ? location_lat : null,
        location_lng: typeof location_lng === "number" ? location_lng : null,
        campaign_id: campaign_id || null,
        challenge_id: challenge_id || null,
        group_label: group_label || null,
      })
      .select()
      .single();

    if (error) {
      const message = error?.message || "Erro ao salvar postagem";
      if (message.toLowerCase().includes("sepbook_posts")) {
        return res
          .status(500)
          .json({ error: "Tabela sepbook_posts ausente. Aplique a migração supabase/migrations/20251115153000_sepbook.sql" });
      }
      return res.status(400).json({ error: message });
    }

    if (participantIds.length > 0) {
      try {
        const rows = participantIds.map((pid) => ({ post_id: post.id, user_id: pid }));
        await admin.from("sepbook_post_participants").insert(rows, { returning: "minimal" } as any);
      } catch {}
    }

    // Criar evento/evidência se a publicação estiver vinculada a uma campanha/desafio ou tiver participantes
    let eventId: string | null = null;
    let eventError: string | null = null;
    try {
      if (campaign_id || challenge_id || participantIds.length > 0) {
        const payload = {
          source: "sepbook",
          sepbook_post_id: post.id,
          content_md: text,
          attachments: atts,
          campaign_id: campaign_id || null,
          group_label: group_label || null,
          location_label: location_label || null,
        };

        const { data: newEvent, error: eventErr } = await admin
          .from("events")
          .insert({
            user_id: uid,
            challenge_id: challenge_id || null,
            status: "submitted",
            evidence_urls: atts,
            payload,
          })
          .select("id")
          .single();

        if (eventErr) throw eventErr;
        eventId = newEvent?.id || null;

        // Upsert participantes (inclui sempre o autor)
        const participantsSet = new Set<string>(participantIds);
        participantsSet.add(uid);
        const participantRows = Array.from(participantsSet).map((pid) => ({ event_id: eventId, user_id: pid }));
        await admin.from("event_participants").upsert(participantRows as any, { onConflict: "event_id,user_id" } as any);
      }
    } catch (e: any) {
      const msg = e?.message || "Falha ao criar evidência";
      eventError = msg;
      console.warn("SEPBook evidence->event error", msg);
    }

    // Atualizar menções com base no conteúdo (post + comentários)
    try {
      await recomputeSepbookMentionsForPost(post.id);
    } catch {}

    // XP por engajamento no SEPBook (post completo) — limitado a 100 XP/mês por usuário.
    // Por enquanto, aplica apenas para o autor; participantes adicionais dependem de migração estável em produção.
    try {
      await admin.rpc("increment_sepbook_profile_xp", { p_user_id: uid, p_amount: 5 }).catch(() => {});
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
