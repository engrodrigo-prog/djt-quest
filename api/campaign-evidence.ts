import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const normalizeTeamId = (raw: any) => String(raw || "").trim().toUpperCase();
const isGuestTeamId = (raw: any) => normalizeTeamId(raw) === "CONVIDADOS";
const isGuestProfile = (p: any) =>
  isGuestTeamId(p?.team_id) || isGuestTeamId(p?.sigla_area) || isGuestTeamId(p?.operational_base);

const STAFF_ROLES = new Set(["admin", "gerente_djt", "gerente_divisao_djtx", "coordenador_djtx"]);
const LEADER_ROLES = new Set(["lider_equipe"]);

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
	    const scopeRaw =
	      (typeof (req.query as any)?.scope === "string"
	        ? (req.query as any).scope
	        : Array.isArray((req.query as any)?.scope)
	          ? (req.query as any).scope[0]
	          : "") || "";
	    const modeRaw =
	      (typeof (req.query as any)?.mode === "string"
	        ? (req.query as any).mode
	        : Array.isArray((req.query as any)?.mode)
	          ? (req.query as any).mode[0]
	          : "") || "";
	    const requestedScope = String(scopeRaw || "").trim().toLowerCase() === "team" ? "team" : "all";
	    const requestedMode = String(modeRaw || "").trim().toLowerCase() === "recent" ? "recent" : "approved";

	    const reader = SERVICE_ROLE_KEY ? admin : authed;

	    let userProfile: any = null;
	    try {
	      const { data } = await reader
	        .from("profiles")
	        .select("id,team_id,sigla_area,operational_base,is_leader")
	        .eq("id", uid)
	        .maybeSingle();
	      userProfile = data || null;
	    } catch {
	      userProfile = null;
	    }

	    let roles: string[] = [];
	    try {
	      const { data } = await admin.from("user_roles").select("role").eq("user_id", uid);
	      roles = Array.isArray(data) ? data.map((r: any) => String(r?.role || "")).filter(Boolean) : [];
	    } catch {
	      roles = [];
	    }

	    const invitedByRole = roles.includes("invited");
	    const isGuest = invitedByRole || isGuestProfile(userProfile);
	    const isLeader = Boolean(userProfile?.is_leader) || roles.some((r) => LEADER_ROLES.has(r));
	    const isStaff = roles.some((r) => STAFF_ROLES.has(r));
	    const canViewAll = isStaff || isLeader;
	    const userTeamId = userProfile?.team_id ? String(userProfile.team_id) : null;

	    // Enforce scope based on permissions:
	    // - Guests: only self for non-approved views.
	    // - Non-leaders: "all" only shows approved + own (recent mode).
	    const scope = requestedScope === "all" && (canViewAll || requestedMode === "approved") ? "all" : requestedScope;
	    const mode = requestedMode;

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
	      const fetchLimit = Math.min(250, scope === "team" ? Math.max(limit, limit * 4) : limit);
	      let q = reader
	        .from("events")
	        .select("id,user_id,challenge_id,status,created_at,final_points,evidence_urls,payload,sap_service_note")
	        .order("created_at", { ascending: false })
	        .limit(fetchLimit);
	      if (evidenceChallengeId) {
	        q = q.eq("challenge_id", evidenceChallengeId);
	      } else {
	        // fallback when evidence challenge isn't present in schema yet
	        q = q.eq("payload->>campaign_id", campaign_id);
	      }
	      if (mode === "approved") {
	        q = q.eq("status", "approved");
	      } else {
	        q = q.in("status", ["submitted", "approved", "rejected", "evaluated"]);
	        if (isGuest) {
	          q = q.eq("user_id", uid);
	        } else if (scope === "all" && !canViewAll) {
	          q = q.or(`status.eq.approved,user_id.eq.${uid}`);
	        }
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
	        .select("id,name,team_id,sigla_area,avatar_url,operational_base")
	        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
	      profiles = Array.isArray(data) ? data : [];
	    } catch {
	      profiles = [];
    }
    const profileMap = new Map<string, any>();
    profiles.forEach((p) => profileMap.set(String(p.id), p));

	    const filteredEvents = (() => {
	      if (mode === "approved") {
	        if (scope === "team" && userTeamId) {
	          return events.filter((e) => String(profileMap.get(String(e.user_id))?.team_id || "") === userTeamId);
	        }
	        return events;
	      }

	      // recent mode
	      if (isGuest) return events.filter((e) => String(e.user_id) === String(uid));
	      if (scope === "team" && userTeamId) {
	        return events.filter((e) => String(profileMap.get(String(e.user_id))?.team_id || "") === userTeamId);
	      }
	      if (scope === "all" && !canViewAll) {
	        return events.filter((e) => String(e.status || "") === "approved" || String(e.user_id) === String(uid));
	      }
	      return events;
	    })().slice(0, limit);

	    const items = filteredEvents.map((e) => {
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
	        status: e.status || null,
	        final_points: e.final_points ?? null,
	        evidence_urls: Array.isArray(e.evidence_urls) ? e.evidence_urls : [],
	        sepbook_post_id: p?.sepbook_post_id || null,
	        location_label: p?.location_label || null,
	        location_lat: typeof p?.location_lat === "number" ? p.location_lat : null,
	        location_lng: typeof p?.location_lng === "number" ? p.location_lng : null,
	        sap_service_note: e.sap_service_note ?? p?.sap_service_note ?? null,
	        tags: Array.isArray(p?.tags) ? p.tags : [],
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
	      permissions: {
	        can_view_all: canViewAll,
	        is_guest: isGuest,
	        user_team_id: userTeamId,
	      },
	      query: { scope, mode },
	      items,
	    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
