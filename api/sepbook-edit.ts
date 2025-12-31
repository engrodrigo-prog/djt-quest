// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { recomputeSepbookMentionsForPost } from "./sepbook-mentions.js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;
const MOD_ROLES = new Set(["admin", "gerente_djt", "gerente_divisao_djtx", "coordenador_djtx"]);

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

    const { post_id, content_md, attachments } = req.body || {};
    const postId = String(post_id || "").trim();
    const text = String(content_md || "").trim();
    const atts = Array.isArray(attachments) ? attachments : [];

    if (!postId) return res.status(400).json({ error: "post_id required" });
    if (!text && atts.length === 0)
      return res.status(400).json({ error: "Conteúdo ou mídia obrigatórios" });

    const { data: post, error: postErr } = await authed
      .from("sepbook_posts")
      .select("id, user_id")
      .eq("id", postId)
      .maybeSingle();
    if (postErr) return res.status(400).json({ error: postErr.message });
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    // Permitir edição apenas do autor ou moderadores
    if (post.user_id !== uid && !isMod) {
      return res.status(403).json({ error: "Sem permissão para editar este post" });
    }

    const { data, error } = await authed
      .from("sepbook_posts")
      .update({
        content_md: text || "",
        attachments: atts,
        has_media: atts.length > 0,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", postId)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    // Recalcular menções (post + comentários)
    try {
      if (!SERVICE_ROLE_KEY) throw new Error("no service role");
      await recomputeSepbookMentionsForPost(postId);
    } catch {}

    return res.status(200).json({ success: true, post: data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
