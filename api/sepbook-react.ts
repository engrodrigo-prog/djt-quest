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

    const { post_id, comment_id, action } = req.body || {};
    const targetId = comment_id || post_id;
    const isComment = Boolean(comment_id);
    if (!targetId || !["like", "unlike"].includes(action)) {
      return res.status(400).json({ error: "Dados inválidos" });
    }

    const table = isComment ? "sepbook_comment_likes" : "sepbook_likes";
    const idColumn = isComment ? "comment_id" : "post_id";
    let alreadyLiked = false;
    let didChange = false;
    if (action === "like") {
      try {
        const { data: existing } = await authed
          .from(table)
          .select(idColumn)
          .eq(idColumn, targetId)
          .eq("user_id", uid)
          .maybeSingle();
        alreadyLiked = Boolean(existing);
      } catch {
        alreadyLiked = false;
      }
    }

    if (action === "like") {
      if (!alreadyLiked) {
        await authed.from(table).upsert({ [idColumn]: targetId, user_id: uid } as any).throwOnError();
        didChange = true;
      }
    } else {
      let hadLike = false;
      try {
        const { data: existing } = await authed
          .from(table)
          .select(idColumn)
          .eq(idColumn, targetId)
          .eq("user_id", uid)
          .maybeSingle();
        hadLike = Boolean(existing);
      } catch {
        hadLike = false;
      }
      if (hadLike) {
        await authed.from(table).delete().eq(idColumn, targetId).eq("user_id", uid).throwOnError();
        didChange = true;
      }
    }

    const { count } = await authed
      .from(table)
      .select(idColumn, { count: "exact", head: true })
      .eq(idColumn, targetId);

    // Best-effort count cache (requires service role or trigger-based maintenance)
    if (SERVICE_ROLE_KEY && !isComment) {
      await admin.from("sepbook_posts").update({ like_count: count || 0 }).eq("id", targetId);
    }

    const xpDelta = didChange ? (action === "like" ? 1 : -1) : 0;
    if (xpDelta !== 0) {
      try {
        await authed.rpc("increment_user_xp", { _user_id: uid, _xp_to_add: xpDelta });
      } catch {}
    }

    return res.status(200).json({ success: true, like_count: count || 0 });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
