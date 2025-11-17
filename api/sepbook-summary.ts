// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.slice(7);
    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { data: lastSeenRow } = await admin
      .from("sepbook_last_seen")
      .select("last_seen_at")
      .eq("user_id", uid)
      .maybeSingle();

    const fallback = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const lastSeen = lastSeenRow?.last_seen_at || fallback;

    const { count: newPosts } = await admin
      .from("sepbook_posts")
      .select("id", { count: "exact", head: true })
      .gt("created_at", lastSeen)
      .neq("user_id", uid);

    const { count: mentions } = await admin
      .from("sepbook_mentions")
      .select("post_id", { count: "exact", head: true })
      .eq("mentioned_user_id", uid)
      .eq("is_read", false);

    return res.status(200).json({
      new_posts: newPosts || 0,
      mentions: mentions || 0,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };

