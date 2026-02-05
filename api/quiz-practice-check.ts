import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const extractYyyyMmDd = (value: unknown) => {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};

const dueEndMsBrt = (dueDate: unknown): number | null => {
  const d = extractYyyyMmDd(dueDate);
  if (!d) return null;
  const dt = new Date(`${d}T23:59:59.999-03:00`);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
};

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Missing Supabase service role config" });
    if (!ANON_KEY) return res.status(500).json({ error: "Missing Supabase anon key" });

    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.slice(7);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const authed = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: authErr } = await authed.auth.getUser();
    if (authErr || !userData?.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const uid = String(userData.user.id);

    const body = parseJsonBody(req);
    const question_id = String(body?.question_id || "").trim();
    const option_id = String(body?.option_id || "").trim();
    if (!UUID_RE.test(question_id)) return res.status(400).json({ error: "question_id inválido" });
    if (!UUID_RE.test(option_id)) return res.status(400).json({ error: "option_id inválido" });

    const { data: q, error: qErr } = await admin
      .from("quiz_questions")
      .select("id, challenge_id")
      .eq("id", question_id)
      .maybeSingle();
    if (qErr) return res.status(400).json({ error: qErr.message });
    const challenge_id = String((q as any)?.challenge_id || "").trim();
    if (!UUID_RE.test(challenge_id)) return res.status(400).json({ error: "Pergunta inválida" });

    // Only allow practice checks after the user has already completed the quiz once.
    // Exception: if the quiz is already closed/expired, allow practice as a fallback (no XP, no persistence).
    const { data: ch, error: chErr } = await admin
      .from("challenges")
      .select("id, status, due_date")
      .eq("id", challenge_id)
      .maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    const status = String((ch as any)?.status || "active").toLowerCase();
    const isLocked = ["closed", "canceled", "cancelled"].includes(status);
    const dueEnd = dueEndMsBrt((ch as any)?.due_date);
    const isExpired = dueEnd != null && Date.now() > dueEnd;

    const { data: attempt, error: aErr } = await admin
      .from("quiz_attempts")
      .select("submitted_at")
      .eq("user_id", uid)
      .eq("challenge_id", challenge_id)
      .maybeSingle();
    if (aErr) return res.status(400).json({ error: aErr.message });
    if (!attempt?.submitted_at && !isLocked && !isExpired) {
      return res.status(403).json({ error: "Treino liberado apenas após concluir o quiz (ou após o encerramento)" });
    }

    const { data: rows, error: oErr } = await admin
      .from("quiz_options")
      .select("id, is_correct")
      .eq("question_id", question_id);
    if (oErr) return res.status(400).json({ error: oErr.message });

    const options = Array.isArray(rows) ? rows : [];
    const correct = options.find((r: any) => Boolean(r?.is_correct));
    const correctOptionId = String(correct?.id || "").trim() || null;
    const selectedRow = options.find((r: any) => String(r?.id || "").trim() === option_id);
    if (!selectedRow) return res.status(400).json({ error: "Alternativa inválida" });

    const isCorrect = Boolean((selectedRow as any)?.is_correct);

    return res.status(200).json({ isCorrect, correctOptionId });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
