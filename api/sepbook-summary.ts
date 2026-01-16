// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;
const TIME_BUDGET_MS = 9000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Prevent unhandled rejections when the timeout wins the race.
  promise.catch(() => undefined as any);
  let t: any;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // This endpoint is used for real-time-ish badge counts; never cache it.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Surrogate-Control", "no-store");

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Invalid server environment" });
  }

  try {
    const deadline = Date.now() + TIME_BUDGET_MS;
    const remaining = () => Math.max(250, deadline - Date.now());

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
      const { data: userData } = await withTimeout(admin.auth.getUser(token), remaining());
      uid = userData?.user?.id || null;
    } catch {
      // Timeout ou indisponibilidade Supabase: devolve contagens zeradas para não quebrar o client
      return res.status(200).json({ new_posts: 0, mentions: 0 });
    }
    if (!uid) {
      return res.status(200).json({ new_posts: 0, mentions: 0 });
    }

    const safeCount = async (query: any, col = "id") => {
      try {
        const { count, error } = await query.select(col, { count: "exact", head: true });
        if (error) return 0;
        return count || 0;
      } catch {
        return 0;
      }
    };

    // Avoid expensive COUNT(*) on large tables; cap the badge count.
    const safeCountCapped = async (query: any, col: string, cap = 99) => {
      try {
        const { data, error } = await query.select(col).limit(cap + 1);
        if (error) return 0;
        const n = Array.isArray(data) ? data.length : 0;
        return Math.min(n, cap);
      } catch {
        return 0;
      }
    };

    let lastSeen = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const { data: lastSeenRow } = await withTimeout(
        admin.from("sepbook_last_seen").select("last_seen_at").eq("user_id", uid).maybeSingle(),
        remaining(),
      );
      if (lastSeenRow?.last_seen_at) {
        lastSeen = lastSeenRow.last_seen_at;
      }
    } catch {
      // Se falhar, mantém o fallback de 7 dias
    }

    const newPosts = await withTimeout(
      safeCountCapped(
        admin.from("sepbook_posts").gt("created_at", lastSeen).neq("user_id", uid).order("created_at", { ascending: false }),
        "id",
        99,
      ),
      remaining(),
    ).catch(() => 0);

    const mentions = await withTimeout(
      safeCountCapped(
        admin.from("sepbook_mentions").eq("mentioned_user_id", uid).eq("is_read", false),
        "post_id",
        99,
      ),
      remaining(),
    ).catch(() => 0);

    const commentMentions = await withTimeout(
      safeCountCapped(
        admin.from("sepbook_comment_mentions").eq("mentioned_user_id", uid).eq("is_read", false),
        "comment_id",
        99,
      ),
      remaining(),
    ).catch(() => 0);

    return res.status(200).json({
      new_posts: newPosts,
      mentions: Number(mentions || 0) + Number(commentMentions || 0),
    });
  } catch {
    // Qualquer outra falha inesperada: retorna zeros em vez de 500
    return res.status(200).json({ new_posts: 0, mentions: 0 });
  }
}

export const config = { api: { bodyParser: false } };
