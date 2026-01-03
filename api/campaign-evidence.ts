import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const clampLimit = (v: any, def = 60, max = 250) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
};

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

    const campaignId =
      (typeof req.query.campaign_id === "string"
        ? req.query.campaign_id
        : Array.isArray(req.query.campaign_id)
          ? req.query.campaign_id[0]
          : "") || "";
    const campaign_id = String(campaignId || "").trim();
    if (!campaign_id) return res.status(400).json({ error: "campaign_id obrigatório" });

    const limit = clampLimit((req.query as any)?.limit, 80, 250);

    const reader = SERVICE_ROLE_KEY ? admin : authed;

    let campaign: any = null;
    try {
      const { data } = await reader
        .from("campaigns")
        .select("id,title,is_active,evidence_challenge_id")
        .eq("id", campaign_id)
        .maybeSingle();
      campaign = data || null;
    } catch {
      campaign = null;
    }

    const evidenceChallengeId = campaign?.evidence_challenge_id ? String(campaign.evidence_challenge_id) : null;

    let events: any[] = [];
    try {
      let q = reader
        .from("events")
        .select("id,user_id,challenge_id,status,created_at,final_points,evidence_urls,payload")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (evidenceChallengeId) {
        q = q.eq("challenge_id", evidenceChallengeId);
      } else {
        // fallback when evidence challenge isn't present in schema yet
        q = q.eq("payload->>campaign_id", campaign_id);
      }
      const { data } = await q;
      events = Array.isArray(data) ? data : [];
    } catch {
      events = [];
    }

    const userIds = Array.from(new Set(events.map((e) => e.user_id).filter(Boolean)));
    let profiles: any[] = [];
    try {
      const { data } = await reader
        .from("profiles")
        .select("id,name,sigla_area,avatar_url,operational_base")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
      profiles = Array.isArray(data) ? data : [];
    } catch {
      profiles = [];
    }
    const profileMap = new Map<string, any>();
    profiles.forEach((p) => profileMap.set(String(p.id), p));

    const items = events.map((e) => {
      const p = e?.payload && typeof e.payload === "object" ? e.payload : {};
      const prof = profileMap.get(String(e.user_id)) || {};
      return {
        id: e.id,
        user_id: e.user_id,
        author_name: prof?.name || "Colaborador",
        author_team: prof?.sigla_area || null,
        author_avatar: prof?.avatar_url || null,
        author_base: prof?.operational_base || null,
        created_at: e.created_at,
        final_points: e.final_points ?? null,
        evidence_urls: Array.isArray(e.evidence_urls) ? e.evidence_urls : [],
        sepbook_post_id: p?.sepbook_post_id || null,
        location_label: p?.location_label || null,
        location_lat: typeof p?.location_lat === "number" ? p.location_lat : null,
        location_lng: typeof p?.location_lng === "number" ? p.location_lng : null,
      };
    });

    return res.status(200).json({
      campaign: campaign
        ? {
            id: campaign.id,
            title: campaign.title || null,
            is_active: campaign.is_active !== false,
            evidence_challenge_id: campaign.evidence_challenge_id || null,
          }
        : null,
      items,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
