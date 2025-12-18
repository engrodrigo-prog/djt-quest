// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
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

    const { action, post_id } = req.body || {};
    if (action === "delete_post") {
      if (!post_id) return res.status(400).json({ error: "post_id required" });
      const { data: post } = await authed
        .from("sepbook_posts")
        .select("id, user_id")
        .eq("id", post_id)
        .maybeSingle();
      if (!post) return res.status(404).json({ error: "Post não encontrado" });
      const isOwner = post.user_id === uid;

      // Reverter XP associado a esta publicação e seus comentários "ricos"
      try {
        if (!SERVICE_ROLE_KEY) throw new Error("no service role");
        if (!isOwner && !isMod) throw new Error("not allowed");
        const authorId = (post as any).user_id as string | undefined;
        if (authorId) {
          try {
            const { data: prof } = await admin.from("profiles").select("xp").eq("id", authorId).maybeSingle();
            const cur = Number((prof as any)?.xp || 0);
            const next = Math.max(0, cur - 5); // cada post gerou +5 XP no momento da criação
            await admin.from("profiles").update({ xp: next }).eq("id", authorId);
          } catch {
            // best-effort: se falhar, não bloqueia a exclusão
          }
        }

        // Comentários ricos (>=30 chars, com # e @) geraram +1 XP cada; reverter também
        try {
          const { data: comments } = await admin
            .from("sepbook_comments")
            .select("user_id, content_md")
            .eq("post_id", post_id);

          for (const c of (comments || [])) {
            const commenterId = (c as any).user_id as string | undefined;
            const text = String((c as any).content_md || "");
            const qualifies =
              text.length >= 30 &&
              text.includes("#") &&
              /@[A-Za-z0-9_.-]+/.test(text);
            if (!commenterId || !qualifies) continue;

            try {
              const { data: prof } = await admin.from("profiles").select("xp").eq("id", commenterId).maybeSingle();
              const cur = Number((prof as any)?.xp || 0);
              const next = Math.max(0, cur - 1);
              await admin.from("profiles").update({ xp: next }).eq("id", commenterId);
            } catch {
              // ignora erros por usuário individual
            }
          }
        } catch {
          // falha ao carregar comentários não impede a exclusão
        }
      } catch {
        // rollback de XP é best-effort; nunca bloqueia exclusão
      }

      const { error } = await authed.from("sepbook_posts").delete().eq("id", post_id);
      if (error) {
        const msg = String(error.message || "");
        if (msg.toLowerCase().includes("row level security") || msg.toLowerCase().includes("permission denied")) {
          return res.status(403).json({ error: "Sem permissão para excluir este post" });
        }
        return res.status(400).json({ error: error.message });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
