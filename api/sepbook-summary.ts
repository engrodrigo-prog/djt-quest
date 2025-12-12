// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Invalid server environment" });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      // Sem config completa: devolve contagens zeradas para não quebrar UI
      return res.status(200).json({ new_posts: 0, mentions: 0 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) {
      // Quando não há token (por exemplo, tela pública), apenas retorna zeros
      return res.status(200).json({ new_posts: 0, mentions: 0 });
    }

    const token = authHeader.slice(7);
    let uid: string | null = null;
    try {
      const { data: userData } = await admin.auth.getUser(token);
      uid = userData?.user?.id || null;
    } catch {
      // Timeout ou indisponibilidade Supabase: devolve contagens zeradas para não quebrar o client
      return res.status(200).json({ new_posts: 0, mentions: 0 });
    }
    if (!uid) {
      return res.status(200).json({ new_posts: 0, mentions: 0 });
    }

    const safeCount = async (query: any) => {
      try {
        const { count, error } = await query.select("id", { count: "exact", head: true });
        if (error) return 0;
        return count || 0;
      } catch {
        return 0;
      }
    };

    let lastSeen = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const { data: lastSeenRow } = await admin
        .from("sepbook_last_seen")
        .select("last_seen_at")
        .eq("user_id", uid)
        .maybeSingle();
      if (lastSeenRow?.last_seen_at) {
        lastSeen = lastSeenRow.last_seen_at;
      }
    } catch {
      // Se falhar, mantém o fallback de 7 dias
    }

    const newPosts = await safeCount(
      admin.from("sepbook_posts").gt("created_at", lastSeen).neq("user_id", uid)
    );

    const mentions = await safeCount(
      admin.from("sepbook_mentions").eq("mentioned_user_id", uid).eq("is_read", false)
    );

    return res.status(200).json({
      new_posts: newPosts,
      mentions,
    });
  } catch {
    // Qualquer outra falha inesperada: retorna zeros em vez de 500
    return res.status(200).json({ new_posts: 0, mentions: 0 });
  }
}

export const config = { api: { bodyParser: false } };
