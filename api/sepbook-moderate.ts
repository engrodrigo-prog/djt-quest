// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;
const MOD_ROLES = new Set(["admin", "gerente_djt", "gerente_divisao_djtx", "coordenador_djtx"]);

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

    const { data: rolesRows } = await admin.from("user_roles").select("role").eq("user_id", uid);
    const roles = (rolesRows || []).map((r: any) => r.role as string);
    const isMod = roles.some((r) => MOD_ROLES.has(r));

    const { action, post_id } = req.body || {};
    if (action === "delete_post") {
      if (!post_id) return res.status(400).json({ error: "post_id required" });
      const { data: post } = await admin
        .from("sepbook_posts")
        .select("id, user_id")
        .eq("id", post_id)
        .maybeSingle();
      if (!post) return res.status(404).json({ error: "Post não encontrado" });
      if (post.user_id !== uid && !isMod) {
        return res.status(403).json({ error: "Sem permissão para excluir este post" });
      }
      const { error } = await admin.from("sepbook_posts").delete().eq("id", post_id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
