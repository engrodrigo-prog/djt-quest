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
    const challenge_id = String(body?.challenge_id || "").trim();
    if (!UUID_RE.test(challenge_id)) return res.status(400).json({ error: "challenge_id inválido" });

    const retry_event_id = String(body?.retry_event_id || "").trim();
    if (retry_event_id && !UUID_RE.test(retry_event_id)) return res.status(400).json({ error: "retry_event_id inválido" });

    const description = String(body?.description || "").trim();
    const evidence_urls = toStringArray(body?.evidence_urls, 12);
    const action_date = String(body?.action_date || "").trim() || null;
    const action_location = String(body?.action_location || "").trim() || null;
    const sap_service_note = String(body?.sap_service_note || "").trim() || null;
    const participant_ids_in = toUuidArray(body?.participant_ids, 60);

    const reader = SERVICE_ROLE_KEY ? admin : authed;

    const { data: challenge, error: chErr } = await reader
      .from("challenges")
      .select("id,require_two_leader_eval,type")
      .eq("id", challenge_id)
      .maybeSingle();
    if (chErr || !challenge?.id) return res.status(400).json({ error: "Desafio não encontrado" });

    const requireTwo = Boolean((challenge as any)?.require_two_leader_eval);
    const isQuiz = String((challenge as any)?.type || "")
      .trim()
      .toLowerCase()
      .includes("quiz");

    if (!isQuiz) {
      if (!action_date || !action_location || !sap_service_note) {
        return res.status(400).json({ error: "Informe data, local e nota SAP" });
      }
    }

    if (description.length < 50) return res.status(400).json({ error: "Descrição deve ter pelo menos 50 caracteres" });

    const writer = SERVICE_ROLE_KEY ? admin : authed;

    const payload = {
      description,
      ...(evidence_urls.length > 0 ? { evidence_urls } : {}),
      action_date,
      action_location,
      sap_service_note,
    };

    const finalStatus = retry_event_id ? "submitted" : requireTwo ? "submitted" : "evaluated";
    const event_id = retry_event_id || null;

    if (event_id) {
      const { error: upErr } = await writer
        .from("events")
        .update({
          payload,
          evidence_urls: evidence_urls.length > 0 ? evidence_urls : [],
          action_date,
          action_location,
          sap_service_note,
          status: finalStatus,
        } as any)
        .eq("id", event_id)
        .eq("user_id", uid);

      if (upErr) {
        const msg = [upErr.message, (upErr as any)?.details, (upErr as any)?.hint].filter(Boolean).join(" • ");
        return res.status(400).json({ error: msg || "Não foi possível atualizar a ação", meta: { code: (upErr as any)?.code || null } });
      }
    } else {
      const { data: newEvent, error: insErr } = await writer
        .from("events")
        .insert({
          user_id: uid,
          challenge_id,
          payload,
          evidence_urls: evidence_urls.length > 0 ? evidence_urls : [],
          action_date,
          action_location,
          sap_service_note,
          status: finalStatus,
        } as any)
        .select("id")
        .single();

      if (insErr) {
        const msg = [insErr.message, (insErr as any)?.details, (insErr as any)?.hint].filter(Boolean).join(" • ");
        return res.status(400).json({ error: msg || "Não foi possível submeter a ação", meta: { code: (insErr as any)?.code || null } });
      }

      const createdId = String((newEvent as any)?.id || "");
      if (!createdId) return res.status(500).json({ error: "Falha ao registrar ação" });

      // Participants (best-effort): include author; keep max 20.
      try {
        const unique = Array.from(new Set(participant_ids_in.filter((id) => id !== uid)));
        const finalIds = Array.from(new Set([uid, ...unique])).slice(0, 20);
        const rows = finalIds.map((id) => ({ event_id: createdId, user_id: id }));
        await writer.from("event_participants").upsert(rows as any, { onConflict: "event_id,user_id" } as any);
      } catch {
        // ignore
      }

      return res.status(200).json({ event_id: createdId });
    }

    // Participants for retry (best-effort)
    try {
      const unique = Array.from(new Set(participant_ids_in.filter((id) => id !== uid)));
      const finalIds = Array.from(new Set([uid, ...unique])).slice(0, 20);
      const rows = finalIds.map((id) => ({ event_id: event_id, user_id: id }));
      await writer.from("event_participants").upsert(rows as any, { onConflict: "event_id,user_id" } as any);
    } catch {
      // ignore
    }

    return res.status(200).json({ event_id });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
}

