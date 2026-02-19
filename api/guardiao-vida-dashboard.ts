import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const STAFF_ROLES = new Set(["admin", "gerente_djt", "gerente_divisao_djtx", "coordenador_djtx"]);
const REPORT_TZ = "America/Sao_Paulo";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const pickQueryParam = (q: any, key: string) => {
  const raw = q?.[key];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0];
  return "";
};

const pickQueryParams = (q: any, key: string) => {
  const raw = q?.[key];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  return [];
};

const toBool = (raw: any) => {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
};

const clampLimit = (v: any, def = 350, max = 1000) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
};

const parseUserIds = (q: any) => {
  const parts = pickQueryParams(q, "user_ids")
    .flatMap((x) => String(x || "").split(","))
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  return unique.filter((x) => UUID_RE.test(x)).slice(0, 12);
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

const normalizeText = (raw: any) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isGuardiaoDaVidaCampaign = (c: any) => {
  const hay = normalizeText(`${c?.title || ""} ${c?.narrative_tag || ""}`);
  const compact = hay.replace(/\s+/g, "");
  return hay.includes("guardiao da vida") || compact.includes("guardiaodavida");
};

const monthKeyInTz = (iso: string) => {
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TZ, year: "numeric", month: "2-digit" }).formatToParts(d);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    if (map.year && map.month) return `${map.year}-${map.month}`;
  } catch {
    // ignore
  }
  return String(iso || "").slice(0, 7);
};

const monthKeysBetween = (fromIso: string, toIso: string) => {
  const out: string[] = [];
  try {
    const start = new Date(fromIso);
    const end = new Date(toIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
    const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 0, 0, 0));
    const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0));
    while (cur.getTime() <= endMonth.getTime() && out.length < 120) {
      out.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  } catch {
    return out;
  }
  return out;
};

const isMissingColumnError = (error: any, column: string) => {
  const code = String(error?.code || "");
  const msg = String(error?.message || "").toLowerCase();
  const col = String(column || "").toLowerCase();
  return code === "42703" || (msg.includes(col) && msg.includes("column"));
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
    if (authErr || !userData?.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const uid = String(userData.user.id);

    let roles: string[] = [];
    try {
      const { data } = await admin.from("user_roles").select("role").eq("user_id", uid);
      roles = Array.isArray(data) ? data.map((r: any) => String(r?.role || "")).filter(Boolean) : [];
    } catch {
      roles = [];
    }
    const isStaff = roles.some((r) => STAFF_ROLES.has(r));
    if (!isStaff) return res.status(403).json({ error: "Acesso restrito (staff)." });

    const reader = SERVICE_ROLE_KEY ? admin : authed;

    const nameRaw = pickQueryParam(req.query, "name");
    const name = String(nameRaw || "").trim();
    const explicitUserIds = parseUserIds(req.query);
    const includeMap = toBool(pickQueryParam(req.query, "include_map"));
    const mapLimit = clampLimit(pickQueryParam(req.query, "map_limit"), 350, 1000);

    const date_start = toIsoDayStart(pickQueryParam(req.query, "date_start"));
    const date_end = toIsoDayEnd(pickQueryParam(req.query, "date_end"));

    const requestedCampaignId = String(pickQueryParam(req.query, "campaign_id") || "").trim();

    let allCampaigns: any[] = [];
    try {
      const { data } = await reader
        .from("campaigns")
        .select("id,title,narrative_tag,start_date,end_date,is_active,evidence_challenge_id")
        .order("start_date", { ascending: false })
        .limit(2000);
      allCampaigns = Array.isArray(data) ? data : [];
    } catch {
      allCampaigns = [];
    }

    const campaigns = allCampaigns.filter(isGuardiaoDaVidaCampaign);

    const now = new Date();
    const defaultCampaign = (() => {
      const active = campaigns.find((c: any) => {
        if (c?.is_active === false) return false;
        const start = c?.start_date ? new Date(String(c.start_date)) : null;
        const end = c?.end_date ? new Date(String(c.end_date)) : null;
        if (start && !Number.isNaN(start.getTime()) && now.getTime() < start.getTime()) return false;
        if (end && !Number.isNaN(end.getTime()) && now.getTime() > end.getTime()) return false;
        return true;
      });
      return active || campaigns[0] || null;
    })();

    const selectedCampaign =
      (requestedCampaignId ? campaigns.find((c: any) => String(c?.id || "") === requestedCampaignId) : null) || defaultCampaign;

    if (!selectedCampaign?.id) {
      return res.status(200).json({
        campaigns: campaigns.map((c: any) => ({
          id: c.id,
          title: c.title || null,
          narrative_tag: c.narrative_tag || null,
          start_date: c.start_date || null,
          end_date: c.end_date || null,
          is_active: c.is_active !== false,
          evidence_challenge_id: c.evidence_challenge_id || null,
        })),
        selected_campaign: null,
        query: { name: name || null, date_start: date_start || null, date_end: date_end || null },
        totals: { actions: 0, people_impacted: 0 },
        monthly: [],
      });
    }

    const evidenceChallengeId = selectedCampaign?.evidence_challenge_id ? String(selectedCampaign.evidence_challenge_id) : "";
    if (!evidenceChallengeId) {
      return res.status(200).json({
        campaigns: campaigns.map((c: any) => ({
          id: c.id,
          title: c.title || null,
          narrative_tag: c.narrative_tag || null,
          start_date: c.start_date || null,
          end_date: c.end_date || null,
          is_active: c.is_active !== false,
          evidence_challenge_id: c.evidence_challenge_id || null,
        })),
        selected_campaign: {
          id: selectedCampaign.id,
          title: selectedCampaign.title || null,
          narrative_tag: selectedCampaign.narrative_tag || null,
          start_date: selectedCampaign.start_date || null,
          end_date: selectedCampaign.end_date || null,
          is_active: selectedCampaign.is_active !== false,
          evidence_challenge_id: null,
        },
        query: { name: name || null, date_start: date_start || null, date_end: date_end || null },
        totals: { actions: 0, people_impacted: 0 },
        publishers: [],
        map_points: includeMap ? [] : undefined,
        monthly: [],
      });
    }

    // Users who already published Guardião da Vida evidences (for multi-select filter UI).
    // Note: independent from date filters; used only to populate the selector list.
    const publisherUserIds = new Set<string>();
    try {
      const publisherPageSize = 1000;
      let pFrom = 0;
      for (let page = 0; page < 20; page++) {
        const { data, error } = await reader
          .from("events")
          .select("user_id,created_at,status")
          .eq("challenge_id", evidenceChallengeId)
          .in("status", ["submitted", "awaiting_second_evaluation", "approved", "evaluated"])
          .order("created_at", { ascending: false })
          .range(pFrom, pFrom + publisherPageSize - 1);
        if (error) break;
        const rows = Array.isArray(data) ? data : [];
        for (const r of rows) {
          const id = String((r as any)?.user_id || "").trim();
          if (id) publisherUserIds.add(id);
          if (publisherUserIds.size >= 2000) break;
        }
        if (publisherUserIds.size >= 2000) break;
        if (rows.length < publisherPageSize) break;
        pFrom += publisherPageSize;
      }
    } catch {
      // ignore
    }

    let publishers: Array<{ id: string; name: string | null; email?: string | null; matricula?: string | null }> = [];
    try {
      const ids = Array.from(publisherUserIds).slice(0, 2000);
      if (ids.length) {
        const { data, error } = await reader
          .from("profiles")
          .select("id,name,email,matricula")
          .in("id", ids)
          .limit(2000);
        if (!error && Array.isArray(data)) {
          publishers = data
            .map((p: any) => ({
              id: String(p?.id || ""),
              name: p?.name != null ? String(p.name) : null,
              email: p?.email != null ? String(p.email) : null,
              matricula: p?.matricula != null ? String(p.matricula) : null,
            }))
            .filter((p) => p.id);
          publishers.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
        }
      }
    } catch {
      publishers = [];
    }

    // Name filter -> user IDs (best-effort).
    let userIdFilter: string[] | null = null;
    let usingExplicitUserIds = false;
    if (explicitUserIds.length) {
      userIdFilter = explicitUserIds;
      usingExplicitUserIds = true;
    } else if (name) {
      try {
        const { data } = await reader
          .from("profiles")
          .select("id")
          .ilike("name", `%${name}%`)
          .limit(2000);
        const ids = Array.isArray(data) ? data.map((r: any) => String(r?.id || "")).filter(Boolean) : [];
        userIdFilter = ids.length ? ids : [];
      } catch {
        userIdFilter = [];
      }
    }

    if (userIdFilter && userIdFilter.length === 0) {
      return res.status(200).json({
        campaigns: campaigns.map((c: any) => ({
          id: c.id,
          title: c.title || null,
          narrative_tag: c.narrative_tag || null,
          start_date: c.start_date || null,
          end_date: c.end_date || null,
          is_active: c.is_active !== false,
          evidence_challenge_id: c.evidence_challenge_id || null,
        })),
        selected_campaign: {
          id: selectedCampaign.id,
          title: selectedCampaign.title || null,
          narrative_tag: selectedCampaign.narrative_tag || null,
          start_date: selectedCampaign.start_date || null,
          end_date: selectedCampaign.end_date || null,
          is_active: selectedCampaign.is_active !== false,
          evidence_challenge_id: evidenceChallengeId,
        },
        query: { name: name || null, date_start: date_start || null, date_end: date_end || null },
        totals: { actions: 0, people_impacted: 0 },
        publishers,
        map_points: includeMap ? [] : undefined,
        monthly: (date_start && date_end ? monthKeysBetween(date_start, date_end) : []).map((m) => ({
          month: m,
          actions: 0,
          people_impacted: 0,
        })),
      });
    }

    const statusFilter = ["submitted", "awaiting_second_evaluation", "approved", "evaluated"];

    let map_points: any[] | undefined = undefined;
    if (includeMap) {
      try {
        let q = reader
          .from("events")
          .select("id,user_id,created_at,status,people_impacted,evidence_urls,payload")
          .eq("challenge_id", evidenceChallengeId)
          .in("status", statusFilter)
          .not("payload->>location_lat", "is", null)
          .not("payload->>location_lng", "is", null)
          .order("created_at", { ascending: false })
          .limit(Math.min(2000, mapLimit * 3));

        if (userIdFilter && userIdFilter.length) q = q.in("user_id", userIdFilter);
        if (date_start) q = q.gte("created_at", date_start);
        if (date_end) q = q.lte("created_at", date_end);

        const { data } = await q;
        const rows = Array.isArray(data) ? data : [];

        const points = [];
        const userIds = new Set<string>();
        for (const r of rows) {
          const payload = (r as any)?.payload && typeof (r as any).payload === "object" ? (r as any).payload : {};
          const lat = Number(payload?.location_lat);
          const lng = Number(payload?.location_lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
          const uid2 = String((r as any)?.user_id || "").trim();
          if (uid2) userIds.add(uid2);

          const evidenceUrls = Array.isArray((r as any)?.evidence_urls) ? (r as any).evidence_urls : [];
          const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
          const urls = [...attachments, ...evidenceUrls].map((x) => (typeof x === "string" ? x : x?.url)).filter(Boolean);

          points.push({
            event_id: String((r as any)?.id || ""),
            user_id: uid2 || null,
            created_at: (r as any)?.created_at || null,
            status: (r as any)?.status || null,
            people_impacted: (r as any)?.people_impacted ?? null,
            location_label: payload?.location_label ?? null,
            location_lat: lat,
            location_lng: lng,
            urls,
          });
          if (points.length >= mapLimit) break;
        }

        let profileMap = new Map<string, any>();
        try {
          const ids = Array.from(userIds).slice(0, 2000);
          if (ids.length) {
            const { data: profs } = await reader.from("profiles").select("id,name,avatar_url,team_id,operational_base").in("id", ids).limit(2000);
            const list = Array.isArray(profs) ? profs : [];
            list.forEach((p: any) => profileMap.set(String(p?.id || ""), p));
          }
        } catch {
          profileMap = new Map();
        }

        map_points = points.map((p: any) => {
          const prof = p.user_id ? profileMap.get(String(p.user_id)) : null;
          return {
            ...p,
            user_name: prof?.name != null ? String(prof.name) : null,
            user_avatar: prof?.avatar_url != null ? String(prof.avatar_url) : null,
            user_team: prof?.team_id != null ? String(prof.team_id) : null,
            user_base: prof?.operational_base != null ? String(prof.operational_base) : null,
          };
        });
      } catch {
        map_points = [];
      }
    }

    let actions = 0;
    let people = 0;
    const monthlyMap = new Map<string, { actions: number; people_impacted: number }>();
    const monthlyByUser = new Map<string, Map<string, { actions: number; people_impacted: number }>>();
    const totalsByUser = new Map<string, { actions: number; people_impacted: number }>();

    const pageSize = 1000;
    let from = 0;
    for (let page = 0; page < 60; page++) {
      let q = reader
        .from("events")
        .select("created_at,people_impacted,status,user_id")
        .eq("challenge_id", evidenceChallengeId)
        .in("status", statusFilter)
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);

      if (userIdFilter) q = q.in("user_id", userIdFilter);
      if (date_start) q = q.gte("created_at", date_start);
      if (date_end) q = q.lte("created_at", date_end);

      const { data, error } = await q;
      if (error) {
	        if (isMissingColumnError(error, "people_impacted")) {
	          // Fallback for older schemas: count actions only.
	          const { data: d2 } = await reader
	            .from("events")
	            .select("created_at,status,user_id")
            .eq("challenge_id", evidenceChallengeId)
            .in("status", statusFilter)
            .order("created_at", { ascending: true })
            .range(from, from + pageSize - 1);
          const rows2 = Array.isArray(d2) ? d2 : [];
          for (const row of rows2) {
            const created_at = String((row as any)?.created_at || "");
            if (!created_at) continue;
            const key = monthKeyInTz(created_at);
            const cur = monthlyMap.get(key) || { actions: 0, people_impacted: 0 };
            cur.actions += 1;
            monthlyMap.set(key, cur);
            actions += 1;
          }
          if (rows2.length < pageSize) break;
          from += pageSize;
          continue;
        }
        throw error;
      }

      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        const created_at = String((row as any)?.created_at || "");
        if (!created_at) continue;
        const key = monthKeyInTz(created_at);
        const impacted = Math.max(0, Math.floor(Number((row as any)?.people_impacted || 0) || 0));
        const user_id = String((row as any)?.user_id || "");
        const cur = monthlyMap.get(key) || { actions: 0, people_impacted: 0 };
        cur.actions += 1;
        cur.people_impacted += impacted;
        monthlyMap.set(key, cur);
        actions += 1;
        people += impacted;

        if (usingExplicitUserIds && user_id) {
          const perMonth = monthlyByUser.get(key) || new Map<string, { actions: number; people_impacted: number }>();
          const perUser = perMonth.get(user_id) || { actions: 0, people_impacted: 0 };
          perUser.actions += 1;
          perUser.people_impacted += impacted;
          perMonth.set(user_id, perUser);
          monthlyByUser.set(key, perMonth);

          const tot = totalsByUser.get(user_id) || { actions: 0, people_impacted: 0 };
          tot.actions += 1;
          tot.people_impacted += impacted;
          totalsByUser.set(user_id, tot);
        }
      }

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    const monthKeys = date_start && date_end ? monthKeysBetween(date_start, date_end) : Array.from(monthlyMap.keys()).sort();

    let selectedUsers: Array<{ id: string; name: string | null }> | null = null;
    if (usingExplicitUserIds) {
      try {
        const { data } = await reader
          .from("profiles")
          .select("id,name")
          .in("id", userIdFilter && userIdFilter.length ? userIdFilter : ["00000000-0000-0000-0000-000000000000"])
          .limit(2000);
        const rows = Array.isArray(data) ? data : [];
        const map = new Map<string, { id: string; name: string | null }>();
        rows.forEach((r: any) => {
          const id = String(r?.id || "");
          if (!id) return;
          map.set(id, { id, name: r?.name != null ? String(r.name) : null });
        });
        selectedUsers = (userIdFilter || []).map((id) => map.get(id) || { id, name: null });
      } catch {
        selectedUsers = (userIdFilter || []).map((id) => ({ id, name: null }));
      }
    }

    const monthly = monthKeys.map((m) => {
      const base = {
        month: m,
        actions: monthlyMap.get(m)?.actions || 0,
        people_impacted: monthlyMap.get(m)?.people_impacted || 0,
      } as any;
      if (usingExplicitUserIds) {
        const perMonth = monthlyByUser.get(m) || new Map<string, { actions: number; people_impacted: number }>();
        const by_user: Record<string, { actions: number; people_impacted: number }> = {};
        (userIdFilter || []).forEach((uid) => {
          const v = perMonth.get(uid) || { actions: 0, people_impacted: 0 };
          by_user[uid] = { actions: v.actions || 0, people_impacted: v.people_impacted || 0 };
        });
        base.by_user = by_user;
      }
      return base;
    });

    return res.status(200).json({
      campaigns: campaigns.map((c: any) => ({
        id: c.id,
        title: c.title || null,
        narrative_tag: c.narrative_tag || null,
        start_date: c.start_date || null,
        end_date: c.end_date || null,
        is_active: c.is_active !== false,
        evidence_challenge_id: c.evidence_challenge_id || null,
      })),
      selected_campaign: {
        id: selectedCampaign.id,
        title: selectedCampaign.title || null,
        narrative_tag: selectedCampaign.narrative_tag || null,
        start_date: selectedCampaign.start_date || null,
        end_date: selectedCampaign.end_date || null,
        is_active: selectedCampaign.is_active !== false,
        evidence_challenge_id: evidenceChallengeId,
      },
      query: { name: name || null, date_start: date_start || null, date_end: date_end || null, user_ids: usingExplicitUserIds ? userIdFilter : null },
      totals: { actions, people_impacted: people },
      publishers,
      map_points,
      users: selectedUsers,
      totals_by_user: usingExplicitUserIds
        ? (userIdFilter || []).reduce((acc: any, id) => {
            acc[id] = totalsByUser.get(id) || { actions: 0, people_impacted: 0 };
            return acc;
          }, {})
        : null,
      monthly,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
