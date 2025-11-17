// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

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

    const { content_md, attachments = [], location_label, location_lat, location_lng } = req.body || {};
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
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Atualizar mentions com base no conteúdo
    try {
      await admin.functions.invoke("sepbook-mentions", {
        body: { post_id: data.id, content_md: text },
      } as any);
    } catch {}

    // XP por engajamento no SEPBook (post completo)
    try {
      await admin.rpc("increment_profile_xp", { p_user_id: uid, p_amount: 5 });
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
