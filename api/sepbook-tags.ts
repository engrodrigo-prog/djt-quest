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

    const { data: campaigns } = await admin
      .from("campaigns")
      .select("id, title")
      .eq("is_active", true)
      .order("title")
      .limit(20);

    const { data: challenges } = await admin
      .from("challenges")
      .select("id, title")
      .in("status", ["active", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(20);

    const campaignTags =
      campaigns?.map((c) => ({
        kind: "campaign",
        id: c.id,
        label: c.title,
        tag: `camp_${String(c.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")}`,
      })) || [];

    const challengeTags =
      challenges?.map((c) => ({
        kind: "challenge",
        id: c.id,
        label: c.title,
        tag: `desafio_${String(c.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")}`,
      })) || [];

    const items = [...campaignTags, ...challengeTags];

    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };

