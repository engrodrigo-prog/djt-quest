import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const parseCsv = (raw: any) =>
  String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const uniq = (items: string[]) => Array.from(new Set(items.map(String).filter(Boolean)));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });

    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.slice(7);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const authed = ANON_KEY
      ? createClient(SUPABASE_URL, ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
      : admin;

    const { data: userData, error: authErr } = await authed.auth.getUser();
    if (authErr) return res.status(401).json({ error: "Unauthorized" });
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const rawIds =
      (typeof (req.query as any)?.campaign_ids === "string"
        ? (req.query as any).campaign_ids
        : Array.isArray((req.query as any)?.campaign_ids)
          ? (req.query as any).campaign_ids[0]
          : "") || "";
    const campaignIds = uniq(parseCsv(rawIds)).slice(0, 60);
    if (campaignIds.length === 0) return res.status(400).json({ error: "campaign_ids obrigatório" });

    const reader = SERVICE_ROLE_KEY ? admin : authed;

    const { data: campaigns } = await reader
      .from("campaigns")
      .select("id,evidence_challenge_id")
      .in("id", campaignIds)
      .limit(2000);

    const list = Array.isArray(campaigns) ? campaigns : [];

    const statsEntries = await Promise.all(
      list.map(async (c: any) => {
        const campaignId = String(c?.id || "");
        const evidenceChallengeId = c?.evidence_challenge_id ? String(c.evidence_challenge_id) : "";
        if (!campaignId || !evidenceChallengeId) {
          return [campaignId, { total: 0, approved: 0, last_event_at: null }] as const;
        }

        let total = 0;
        let last_event_at: string | null = null;
        try {
          const { data: rows, count } = await reader
            .from("events")
            .select("created_at", { count: "exact" })
            .eq("challenge_id", evidenceChallengeId)
            .in("status", ["submitted", "approved", "rejected", "evaluated"])
            .order("created_at", { ascending: false })
            .limit(1);
          total = Number(count || 0);
          const first = Array.isArray(rows) && rows.length ? rows[0] : null;
          last_event_at = first?.created_at ? String(first.created_at) : null;
        } catch {
          total = 0;
          last_event_at = null;
        }

        let approved = 0;
        try {
          const { count } = await reader
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("challenge_id", evidenceChallengeId)
            .eq("status", "approved");
          approved = Number(count || 0);
        } catch {
          approved = 0;
        }

        return [campaignId, { total, approved, last_event_at }] as const;
      }),
    );

    const stats: Record<string, { total: number; approved: number; last_event_at: string | null }> = {};
    for (const [cid, v] of statsEntries) {
      if (cid) stats[cid] = v;
    }

    return res.status(200).json({ stats });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };

