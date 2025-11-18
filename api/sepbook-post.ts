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

    const { content_md, attachments = [], location_label, location_lat, location_lng, campaign_id, participant_ids } = req.body || {};
    const text = String(content_md || "").trim();
    const atts = Array.isArray(attachments) ? attachments : [];
    if (!text && atts.length === 0) return res.status(400).json({ error: "Conteúdo ou mídia obrigatórios" });

    const { data: profile } = await admin.from("profiles").select("name, sigla_area, avatar_url, operational_base").eq("id", uid).maybeSingle();

    const { data, error } = await admin
      .from("sepbook_posts")
      .insert({
        user_id: uid,
        content_md: text,
        attachments: atts,
        has_media: atts.length > 0,
        location_label: location_label || null,
        location_lat: typeof location_lat === "number" ? location_lat : null,
        location_lng: typeof location_lng === "number" ? location_lng : null,
        campaign_id: typeof campaign_id === "string" && campaign_id.trim().length > 0 ? campaign_id : null,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Atualizar menções com base no conteúdo (post + comentários)
    try {
      await recomputeSepbookMentionsForPost(data.id);
    } catch {}

    // XP por engajamento no SEPBook (post completo) — limitado a 100 XP/mês por usuário.
    // Agora aplica para o autor e participantes marcados (sem duplicar).
    try {
      const participants = new Set<string>();
      participants.add(uid);
      if (Array.isArray(participant_ids)) {
        for (const raw of participant_ids) {
          const id = String(raw || "").trim();
          if (id) participants.add(id);
        }
      }

      const ids = Array.from(participants);

      // Registrar participantes vinculados ao post
      if (ids.length > 0) {
        const rows = ids.map((userId) => ({ post_id: data.id, user_id: userId }));
        await admin.from("sepbook_post_participants").insert(rows as any).catch(() => {});
      }

      // Incrementar XP (função já limita a 100 XP/mês por usuário)
      for (const id of ids) {
        await admin.rpc("increment_sepbook_profile_xp", { p_user_id: id, p_amount: 5 }).catch(() => {});
      }
    } catch {}

    return res.status(200).json({
      success: true,
      post: {
        ...data,
        author_name: profile?.name || "Colaborador",
        author_team: profile?.sigla_area || null,
        author_avatar: profile?.avatar_url || null,
        author_base: (profile as any)?.operational_base || null,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
