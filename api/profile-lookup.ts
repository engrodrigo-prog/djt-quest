import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const ALLOWED_MODES = new Set(["matricula_exact", "matricula_partial", "email", "name", "id"]);

const clampLimit = (value: any, fallback = 10, max = 20) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
};

const parseBody = (req: VercelRequest) => {
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
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });

    const body = parseBody(req);
    const mode = String(body?.mode || "").trim();
    if (!ALLOWED_MODES.has(mode)) return res.status(400).json({ error: "mode inválido" });

    const query = String(body?.query || "").trim();
    if (!query) return res.status(400).json({ error: "query obrigatório" });

    const limit = clampLimit(body?.limit, 10, 20);
    const orderBy = mode === "matricula_partial" ? "matricula" : "name";

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const reader = SERVICE_ROLE_KEY ? admin : createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    let q = reader.from("profiles").select("id, name, email, matricula");

    if (mode === "matricula_exact") {
      q = q.eq("matricula", query);
    } else if (mode === "matricula_partial") {
      q = q.ilike("matricula", `%${query}%`);
    } else if (mode === "email") {
      q = q.or(`email.eq.${query.toLowerCase()},email.ilike.%${query.toLowerCase()}%`);
    } else if (mode === "name") {
      q = q.or(`name.ilike.%${query.toLowerCase()}%,email.ilike.%${query.toLowerCase()}%`);
    } else if (mode === "id") {
      q = q.eq("id", query);
    }

    const { data, error } = await q.order(orderBy, { ascending: true }).limit(limit);
    if (error) return res.status(400).json({ error: error.message || "Falha ao buscar perfis" });

    return res.status(200).json({ users: Array.isArray(data) ? data : [] });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
}

