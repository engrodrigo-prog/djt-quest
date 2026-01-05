// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

function formatName(name: string | null | undefined) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 1) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function toMentionHandle(name: string | null | undefined) {
  const raw = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove accents
  const cleaned = raw
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const parts = cleaned.split(" ").filter(Boolean);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return last ? `${first}.${last}` : first;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const q = String(req.query.q || "").trim();
    if (!q || q.length < 1) return res.status(200).json({ items: [] });

    // Sugestões de equipes (sigla_area)
    const { data: teamsRaw } = await admin
      .from("profiles")
      .select("sigla_area")
      .not("sigla_area", "is", null)
      .ilike("sigla_area", `%${q}%`)
      .limit(20);

    const teamHandles = new Set<string>();
    (teamsRaw || []).forEach((row: any) => {
      if (row.sigla_area) teamHandles.add(String(row.sigla_area));
    });

    const teamSuggestions = Array.from(teamHandles).map((sigla) => ({
      kind: "team",
      handle: sigla,
      label: `Equipe ${sigla}`,
    }));

    // Sugestões de pessoas (por nome/email/sigla/handle)
    let users: any[] = [];
    try {
      const { data } = await admin
        .from("profiles")
        .select("id, name, email, sigla_area, operational_base, mention_handle")
        .or(`name.ilike.%${q}%,email.ilike.%${q}%,sigla_area.ilike.%${q}%,mention_handle.ilike.%${q}%`)
        .limit(25);
      users = (data as any[]) || [];
    } catch {
      const { data } = await admin
        .from("profiles")
        .select("id, name, email, sigla_area, operational_base")
        .or(`name.ilike.%${q}%,email.ilike.%${q}%,sigla_area.ilike.%${q}%`)
        .limit(25);
      users = (data as any[]) || [];
    }

    const userSuggestions =
      (users || []).map((u: any) => ({
        kind: "user",
        handle: String(u.mention_handle || toMentionHandle(u.name) || u.email || "").trim(),
        label: `${formatName(u.name)} — ${u.sigla_area || "DJT"}`,
        base: u.operational_base || null,
      })) || [];

    const items = [...teamSuggestions, ...userSuggestions].slice(0, 15);
    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
