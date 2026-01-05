// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

export function extractSepbookMentions(md: string): string[] {
  // Regra: captura @email ou @identificador simples (equipes, siglas, etc.)
  return Array.from(md.matchAll(/@([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/g)).map(
    (m) => m[1]
  );
}

export async function recomputeSepbookMentionsForPost(postId: string) {
  assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const id = String(postId || "").trim();
  if (!id) return;

  // Carregar post e comentários associados para considerar menções no contexto inteiro
  const [{ data: postRow }, { data: comments }] = await Promise.all([
    admin.from("sepbook_posts").select("id, content_md").eq("id", id).maybeSingle(),
    admin.from("sepbook_comments").select("content_md").eq("post_id", id),
  ]);

  const pieces: string[] = [];
  if (postRow?.content_md) pieces.push(String(postRow.content_md));
  (comments || []).forEach((c: any) => {
    if (c.content_md) pieces.push(String(c.content_md));
  });

  const fullText = pieces.join("\n\n").trim();
  if (!fullText) {
    await admin.from("sepbook_mentions").delete().eq("post_id", id);
    return;
  }

  const mentions = extractSepbookMentions(fullText);
  if (!mentions.length) {
    await admin.from("sepbook_mentions").delete().eq("post_id", id);
    return;
  }

  const emailMentions = Array.from(new Set(mentions.filter((m) => m.includes("@"))));
  const handleMentions = Array.from(new Set(mentions.filter((m) => !m.includes("@") && m.includes("."))));
  const teamMentions = Array.from(new Set(mentions.filter((m) => !m.includes("@") && !m.includes("."))));

  let ids: string[] = [];

  if (emailMentions.length) {
    const { data: usersByEmail } = await admin
      .from("profiles")
      .select("id, email")
      .in("email", emailMentions);
    ids.push(...((usersByEmail || []).map((u: any) => u.id)));
  }

  if (handleMentions.length) {
    try {
      const { data: usersByHandle } = await admin
        .from("profiles")
        .select("id, mention_handle")
        .in("mention_handle", handleMentions);
      ids.push(...((usersByHandle || []).map((u: any) => u.id)));
    } catch {
      // schema without mention_handle: ignore (best-effort)
    }
  }

  for (const code of teamMentions) {
    const upper = code.toUpperCase();
    let query = admin.from("profiles").select("id, sigla_area");

    if (upper === "DJT" || upper === "DJTB" || upper === "DJTV") {
      query = query.ilike("sigla_area", `${upper}-%`);
    } else {
      query = query.eq("sigla_area", upper);
    }

    const { data: teamProfiles } = await query;
    ids.push(...((teamProfiles || []).map((u: any) => u.id)));
  }

  ids = Array.from(new Set(ids));

  await admin.from("sepbook_mentions").delete().eq("post_id", id);
  if (ids.length) {
    const rows = ids.map((uid: string) => ({
      post_id: id,
      mentioned_user_id: uid,
      is_read: false,
    }));
    await admin.from("sepbook_mentions").insert(rows as any);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { post_id, content_md } = req.body || {};
    const postId = String(post_id || "").trim();
    const text = String(content_md || "").trim();
    if (!postId || !text) return res.status(400).json({ error: "post_id e content_md obrigatórios" });

    const mentions = extractSepbookMentions(text);
    if (!mentions.length) {
      await admin.from("sepbook_mentions").delete().eq("post_id", postId);
      return res.status(200).json({ success: true, mentions: [] });
    }

  const emailMentions = Array.from(new Set(mentions.filter((m) => m.includes("@"))));
  const handleMentions = Array.from(new Set(mentions.filter((m) => !m.includes("@") && m.includes("."))));
  const teamMentions = Array.from(new Set(mentions.filter((m) => !m.includes("@") && !m.includes("."))));

    let ids: string[] = [];

    // Menções diretas por e-mail
    if (emailMentions.length) {
      const { data: usersByEmail } = await admin
        .from("profiles")
        .select("id, email")
        .in("email", emailMentions);
    ids.push(...((usersByEmail || []).map((u: any) => u.id)));
  }

  if (handleMentions.length) {
    try {
      const { data: usersByHandle } = await admin
        .from("profiles")
        .select("id, mention_handle")
        .in("mention_handle", handleMentions);
      ids.push(...((usersByHandle || []).map((u: any) => u.id)));
    } catch {
      // schema without mention_handle: ignore (best-effort)
    }
  }

  // Menções por equipe/sigla (ex.: DJT, DJTV-SUL, DJTB-CUB)
  for (const code of teamMentions) {
    const upper = code.toUpperCase();
      let query = admin.from("profiles").select("id, sigla_area");

      if (upper === "DJT" || upper === "DJTB" || upper === "DJTV") {
        // Departamento / grupo maior: qualquer sigla que comece com esse prefixo
        query = query.ilike("sigla_area", `${upper}-%`);
      } else {
        // Equipe específica
        query = query.eq("sigla_area", upper);
      }

      const { data: teamProfiles } = await query;
      ids.push(...((teamProfiles || []).map((u: any) => u.id)));
    }

    ids = Array.from(new Set(ids));

    // limpar mentions antigas e inserir novas
    await admin.from("sepbook_mentions").delete().eq("post_id", postId);
    if (ids.length) {
      const rows = ids.map((uid: string) => ({
        post_id: postId,
        mentioned_user_id: uid,
        is_read: false,
      }));
      await admin.from("sepbook_mentions").insert(rows as any);
    }

    return res.status(200).json({ success: true, mentions: ids.length });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
