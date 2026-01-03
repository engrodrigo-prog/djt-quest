import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const clampLimit = (v: any, def = 20, max = 80) => {
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
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const authed = ANON_KEY
      ? createClient(SUPABASE_URL, ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
      : admin;

    // Prefer service role when available (can list offline campaigns); fallback to RLS-limited view.
    const reader = SERVICE_ROLE_KEY ? admin : authed;

    const q =
      (typeof req.query.q === "string"
        ? req.query.q
        : Array.isArray(req.query.q)
          ? req.query.q[0]
          : "") || "";
    const query = String(q || "").trim();
    const limit = clampLimit((req.query as any)?.limit, query ? 25 : 35, 80);

    let rows: any[] = [];
    if (!query) {
      // Default: active campaigns first; if service role is available, include some offline ones too.
      const { data: active } = await reader
        .from("campaigns")
        .select("id,title,is_active,start_date,end_date,evidence_challenge_id")
        .eq("is_active", true)
        .order("start_date", { ascending: false })
        .limit(Math.min(limit, 30));

      rows = Array.isArray(active) ? active : [];

      if (SERVICE_ROLE_KEY && rows.length < limit) {
        const { data: offline } = await admin
          .from("campaigns")
          .select("id,title,is_active,start_date,end_date,evidence_challenge_id")
          .eq("is_active", false)
          .order("end_date", { ascending: false })
          .limit(Math.max(0, Math.min(20, limit - rows.length)));
        if (Array.isArray(offline)) rows = [...rows, ...offline];
      }
    } else {
      // Search by title (case-insensitive)
      const base = reader
        .from("campaigns")
        .select("id,title,is_active,start_date,end_date,evidence_challenge_id")
        .ilike("title", `%${query.replace(/[%_]/g, "\\$&")}%`);

      // Best-effort ordering: service role sees offline too; RLS may filter automatically.
      const { data } = await base.order("is_active", { ascending: false }).order("start_date", { ascending: false }).limit(limit);
      rows = Array.isArray(data) ? data : [];
    }

    const items = rows.map((c) => {
      const offline = c.is_active === false;
      const title = String(c.title || "").trim();
      return {
        id: c.id,
        title,
        is_active: c.is_active !== false,
        evidence_challenge_id: (c as any).evidence_challenge_id || null,
        label: offline ? `${title} (campanha offline)` : title,
      };
    });

    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
