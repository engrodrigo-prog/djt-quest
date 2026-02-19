import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeTeamId = (raw: any) => String(raw || "").trim().toUpperCase();
const isGuestTeamId = (raw: any) => normalizeTeamId(raw) === "CONVIDADOS";
const isGuestProfile = (p: any) =>
  isGuestTeamId(p?.team_id) || isGuestTeamId(p?.sigla_area) || isGuestTeamId(p?.operational_base);

const parseJsonBody = (req: VercelRequest) => {
  const raw = (req as any)?.body;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? raw : {};
};

const toStringArray = (value: any, max = 200) =>
  (Array.isArray(value) ? value : [])
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .slice(0, max);

const toUuidArray = (value: any, max = 200) =>
  Array.from(new Set(toStringArray(value, max).filter((v) => UUID_RE.test(v))));

const toNumberOrNull = (value: any) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

const isMissingColumnError = (error: any, column: string) => {
  const code = String(error?.code || "");
  const msg = String(error?.message || "").toLowerCase();
  const col = String(column || "").toLowerCase();
  return code === "42703" || (msg.includes(col) && msg.includes("column"));
};

const clampLocation = (lat: number | null, lng: number | null) => {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9) return null;
  return { lat, lng };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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

    const body = parseJsonBody(req);
    const campaign_id = String(body?.campaign_id || "").trim();
    if (!UUID_RE.test(campaign_id)) return res.status(400).json({ error: "campaign_id inválido" });

    const attachments = toStringArray(body?.attachments, 12);
    const content_md = String(body?.content_md || body?.description || "").trim();
    const transcript = String(body?.transcript || "").trim() || null;
    const tags = toStringArray(body?.tags, 12);
    const gps_meta = Array.isArray(body?.gps_meta) ? body.gps_meta.slice(0, 50) : [];
    const location_label = String(body?.location_label || "").trim() || null;
    const locationLatRaw = toNumberOrNull(body?.location_lat);
    const locationLngRaw = toNumberOrNull(body?.location_lng);
    const coords = clampLocation(locationLatRaw, locationLngRaw);
    const sap_service_note_in = String(body?.sap_service_note || "").trim() || null;
    const peopleImpactedRaw = toNumberOrNull(body?.people_impacted ?? body?.people_reached ?? body?.people_atingidas);
    const people_impacted = peopleImpactedRaw == null ? null : Math.max(0, Math.floor(peopleImpactedRaw));
    const participant_ids_in = toUuidArray(body?.participant_ids, 60);

    const reader = SERVICE_ROLE_KEY ? admin : authed;

    const { data: camp, error: campErr } = await reader
      .from("campaigns")
      .select("id,title,narrative_tag,evidence_challenge_id")
      .eq("id", campaign_id)
      .maybeSingle();
    if (campErr || !camp?.id) return res.status(400).json({ error: "Campanha não encontrada" });

    const isGuardiaoDaVida = isGuardiaoDaVidaCampaign(camp);
    if (isGuardiaoDaVida) {
      if (!coords) return res.status(400).json({ error: "Geolocalização obrigatória para esta campanha (GPS)." });
      if (!Number.isFinite(Number(people_impacted)) || Number(people_impacted) < 1) {
        return res.status(400).json({ error: "Informe a quantidade de pessoas atingidas (mín. 1)." });
      }
    }

    const challenge_id_raw = String((camp as any)?.evidence_challenge_id || "").trim();
    const challenge_id = UUID_RE.test(challenge_id_raw) ? challenge_id_raw : null;

    // Ensure profile exists (service role only; best-effort).
    if (SERVICE_ROLE_KEY) {
      try {
        const { data: prof } = await admin.from("profiles").select("id").eq("id", uid).maybeSingle();
        if (!prof?.id) {
          const email = userData.user.email || null;
          const metaName =
            (userData.user.user_metadata as any)?.name ||
            (userData.user.user_metadata as any)?.full_name ||
            (userData.user.user_metadata as any)?.nome ||
            "";
          const nameGuess = String(metaName || "").trim() || (email ? email.split("@")[0] : "") || "Colaborador";
          await admin.from("profiles").insert({ id: uid, email, name: nameGuess.slice(0, 120) } as any);
        }
      } catch {
        // ignore
      }
    }

    const writer = SERVICE_ROLE_KEY ? admin : authed;

    const payload = {
      source: "campaign_evidence",
      campaign_id,
      description: content_md,
      transcript,
      tags,
      gps_meta,
      location_label,
      location_lat: coords ? coords.lat : null,
      location_lng: coords ? coords.lng : null,
      people_impacted: people_impacted ?? null,
      publish_sepbook: false,
      attachments,
    };

    const insertRow = async (row: any) =>
      await writer
        .from("events")
        .insert(row as any)
        .select("id")
        .single();

    const baseRow: any = {
      user_id: uid,
      challenge_id,
      status: "submitted",
      evidence_urls: attachments,
      sap_service_note: isGuardiaoDaVida ? null : sap_service_note_in,
      people_impacted: people_impacted ?? null,
      payload,
    };

    let rowToInsert = { ...baseRow };
    let evResp: any = null;
    for (let i = 0; i < 3; i++) {
      evResp = await insertRow(rowToInsert);
      if (!evResp.error) break;
      if ("people_impacted" in rowToInsert && isMissingColumnError(evResp.error, "people_impacted")) {
        delete (rowToInsert as any).people_impacted;
        continue;
      }
      if ("evidence_urls" in rowToInsert && isMissingColumnError(evResp.error, "evidence_urls")) {
        delete (rowToInsert as any).evidence_urls;
        continue;
      }
      break;
    }
    const ev = evResp.data;
    const evErr = evResp.error;

    if (evErr) {
      const msg = [evErr.message, (evErr as any)?.details, (evErr as any)?.hint].filter(Boolean).join(" • ");
      return res.status(400).json({ error: msg || "Falha ao registrar evidência", meta: { code: (evErr as any)?.code || null } });
    }

    const event_id = String((ev as any)?.id || "");
    if (!event_id) return res.status(500).json({ error: "Falha ao registrar evidência" });

    // Participants (best-effort): always include author; enforce guest rules + max 20.
    try {
      const unique = Array.from(new Set(participant_ids_in.filter((id) => id !== uid)));
      const toCheck = Array.from(new Set([uid, ...unique])).slice(0, 60);

      let profiles: any[] = [];
      let roles: any[] = [];
      try {
        const profResp = await admin
          .from("profiles")
          .select("id,team_id,sigla_area,operational_base")
          .in("id", toCheck.length ? toCheck : ["00000000-0000-0000-0000-000000000000"]);
        profiles = Array.isArray(profResp.data) ? (profResp.data as any[]) : [];
      } catch {
        profiles = [];
      }
      try {
        const roleResp = await admin
          .from("user_roles")
          .select("user_id,role")
          .in("user_id", toCheck.length ? toCheck : ["00000000-0000-0000-0000-000000000000"]);
        roles = Array.isArray(roleResp.data) ? (roleResp.data as any[]) : [];
      } catch {
        roles = [];
      }

      const profileMap = new Map<string, any>();
      profiles.forEach((p) => profileMap.set(String(p.id), p));

      const rolesMap = new Map<string, Set<string>>();
      roles.forEach((r) => {
        const id = String(r?.user_id || "");
        const role = String(r?.role || "");
        if (!id || !role) return;
        const set = rolesMap.get(id) || new Set<string>();
        set.add(role);
        rolesMap.set(id, set);
      });

      const isGuestId = (id: string) => {
        if (rolesMap.get(id)?.has("invited")) return true;
        return isGuestProfile(profileMap.get(id));
      };

      const authorIsGuest = isGuestId(uid);
      const allowedOthers = authorIsGuest ? [] : unique.filter((id) => !isGuestId(id));

      const finalIds = Array.from(new Set([uid, ...allowedOthers])).slice(0, 20);
      const rows = finalIds.map((id) => ({ event_id, user_id: id }));
      await writer.from("event_participants").upsert(rows as any, { onConflict: "event_id,user_id" } as any);
    } catch {
      // ignore
    }

    return res.status(200).json({ event_id });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
}
