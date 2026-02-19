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

const STAFF_ROLES = new Set([
  "admin",
  "gerente",
  "gerente_djt",
  "gerente_divisao_djtx",
  "lider_divisao",
  "coordenador",
  "coordenador_djtx",
]);
const LEADER_ROLES = new Set(["lider_equipe"]);

const clampLimit = (v: any, def = 60, max = 250) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
};

const pickQueryParam = (q: any, key: string) => {
  const raw = q?.[key];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0];
  return "";
};

const toIsoDayStart = (raw: any) => {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
  } catch {
    return null;
  }
};

const toIsoDayEnd = (raw: any) => {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59:59.999Z`;
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)).toISOString();
  } catch {
    return null;
  }
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
	    const scopeRaw = pickQueryParam(req.query, "scope");
	    const modeRaw =
	      pickQueryParam(req.query, "mode");
	    const userIdRaw = pickQueryParam(req.query, "user_id");
	    const dateStartRaw = pickQueryParam(req.query, "date_start");
	    const dateEndRaw = pickQueryParam(req.query, "date_end");

	    const requestedScope = (() => {
	      const s = String(scopeRaw || "").trim().toLowerCase();
	      if (s === "team") return "team";
	      if (s === "all") return "all";
	      return "mine";
	    })();
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
	    // - Guests: always self.
	    // - Non-leaders: only self (even approved mode), per product requirement.
	    const scope = (() => {
	      if (isGuest) return "mine";
	      if (!canViewAll) return "mine";
	      return requestedScope;
	    })();
	    const mode = requestedMode;

	    const requestedUserId = String(userIdRaw || "").trim();
	    const user_id_filter = requestedUserId && (canViewAll || requestedUserId === uid) ? requestedUserId : "";

	    const date_start = toIsoDayStart(dateStartRaw);
	    const date_end = toIsoDayEnd(dateEndRaw);

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
	        .select("id,user_id,challenge_id,status,created_at,final_points,evidence_urls,payload,sap_service_note,people_impacted")
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
	        if (scope === "mine") q = q.eq("user_id", uid);
	      }
	      if (scope === "mine") q = q.eq("user_id", uid);
	      if (user_id_filter) q = q.eq("user_id", user_id_filter);
	      if (date_start) q = q.gte("created_at", date_start);
	      if (date_end) q = q.lte("created_at", date_end);
	      const { data, error } = await q;
	      if (error && String((error as any)?.code || "") === "42703") {
	        // Backwards compatibility: some schemas may not have people_impacted.
	        const { data: d2 } = await reader
	          .from("events")
	          .select("id,user_id,challenge_id,status,created_at,final_points,evidence_urls,payload,sap_service_note")
	          .order("created_at", { ascending: false })
	          .limit(fetchLimit);
	        events = Array.isArray(d2) ? d2 : [];
	      } else {
	        events = Array.isArray(data) ? data : [];
	      }
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
	        if (scope === "mine") {
	          return events.filter((e) => String(e.user_id) === String(uid));
	        }
	        if (scope === "team" && userTeamId) {
	          return events.filter((e) => String(profileMap.get(String(e.user_id))?.team_id || "") === userTeamId);
	        }
	        return events;
	      }

	      // recent mode
	      if (scope === "mine") return events.filter((e) => String(e.user_id) === String(uid));
	      if (scope === "team" && userTeamId) {
	        return events.filter((e) => String(profileMap.get(String(e.user_id))?.team_id || "") === userTeamId);
	      }
	      return events;
	    })().slice(0, limit);

	    const eventIds = filteredEvents.map((e) => String(e.id)).filter(Boolean);
	    let evalRows: any[] = [];
	    try {
	      if (eventIds.length) {
	        const { data } = await reader
	          .from("action_evaluations")
	          .select("id,event_id,reviewer_id,reviewer_level,rating,final_rating,feedback_positivo,feedback_construtivo,created_at,evaluation_number")
	          .in("event_id", eventIds);
	        evalRows = Array.isArray(data) ? data : [];
	      } else {
	        evalRows = [];
	      }
	    } catch {
	      evalRows = [];
	    }

	    const reviewerIds = Array.from(new Set(evalRows.map((r) => r?.reviewer_id).filter(Boolean)));
	    let reviewerProfiles: any[] = [];
	    try {
	      const { data } = await reader
	        .from("profiles")
	        .select("id,name,avatar_url,sigla_area,team_id,operational_base")
	        .in("id", reviewerIds.length ? reviewerIds : ["00000000-0000-0000-0000-000000000000"]);
	      reviewerProfiles = Array.isArray(data) ? data : [];
	    } catch {
	      reviewerProfiles = [];
	    }
	    const reviewerMap = new Map<string, any>();
	    reviewerProfiles.forEach((p) => reviewerMap.set(String(p.id), p));

	    const evalMap = new Map<string, any[]>();
	    evalRows.forEach((r) => {
	      const eid = String(r?.event_id || "");
	      if (!eid) return;
	      const rp = reviewerMap.get(String(r?.reviewer_id || "")) || {};
	      const row = {
	        id: r?.id || null,
	        event_id: eid,
	        reviewer_id: r?.reviewer_id || null,
	        reviewer_name: rp?.name || "Avaliador",
	        reviewer_avatar: rp?.avatar_url || null,
	        reviewer_team: rp?.sigla_area || null,
	        reviewer_base: rp?.operational_base || null,
	        reviewer_level: r?.reviewer_level || null,
	        evaluation_number: r?.evaluation_number ?? null,
	        rating: typeof r?.rating === "number" ? r.rating : r?.rating ?? null,
	        final_rating: typeof r?.final_rating === "number" ? r.final_rating : r?.final_rating ?? null,
	        feedback_positivo: r?.feedback_positivo ?? null,
	        feedback_construtivo: r?.feedback_construtivo ?? null,
	        created_at: r?.created_at || null,
	      };
	      const arr = evalMap.get(eid) || [];
	      arr.push(row);
	      evalMap.set(eid, arr);
	    });
	    evalMap.forEach((arr, key) => {
	      arr.sort((a, b) => {
	        const an = typeof a?.evaluation_number === "number" ? a.evaluation_number : 99;
	        const bn = typeof b?.evaluation_number === "number" ? b.evaluation_number : 99;
	        if (an !== bn) return an - bn;
	        return String(a?.created_at || "").localeCompare(String(b?.created_at || ""));
	      });
	      evalMap.set(key, arr);
	    });

	    const items = filteredEvents.map((e) => {
	      const p = e?.payload && typeof e.payload === "object" ? e.payload : {};
	      const prof = profileMap.get(String(e.user_id)) || {};
	      const evaluations = evalMap.get(String(e.id)) || [];
	      const ratings = evaluations.map((x) => Number(x?.rating)).filter((n) => Number.isFinite(n));
	      const avg_rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
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
	        avg_rating,
	        evaluations,
	        evidence_urls: Array.isArray(e.evidence_urls) ? e.evidence_urls : [],
	        sepbook_post_id: p?.sepbook_post_id || null,
	        location_label: p?.location_label || null,
	        location_lat: typeof p?.location_lat === "number" ? p.location_lat : null,
	        location_lng: typeof p?.location_lng === "number" ? p.location_lng : null,
	        sap_service_note: e.sap_service_note ?? p?.sap_service_note ?? null,
	        people_impacted: typeof (e as any)?.people_impacted === "number" ? (e as any).people_impacted : p?.people_impacted ?? null,
	        tags: Array.isArray(p?.tags) ? p.tags : [],
	      };
	    });

	    const total_xp = items
	      .map((it: any) => Number(it?.final_points))
	      .filter((n) => Number.isFinite(n))
	      .reduce((a, b) => a + b, 0);

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
	      query: { scope, mode, user_id: user_id_filter || null, date_start: date_start || null, date_end: date_end || null },
	      totals: { items: items.length, total_xp },
	      items,
	    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
