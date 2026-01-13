// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv, DJT_QUEST_SUPABASE_HOST } from "../server/env-guard.js";
import { getSupabaseUrlFromEnv } from "../server/lib/supabase-url.js";

const SUPABASE_URL =
  getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true }) ||
  (process.env.SUPABASE_URL as string);
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;

const isImageUrl = (url: string) => /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(String(url || "").toLowerCase());

const parsePostIds = (raw: any) => {
  const v = String(raw || "").trim();
  if (!v) return [];
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 120);
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

    const authed = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: userData, error: authErr } = await authed.auth.getUser();
    if (authErr || !userData?.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const reader = SERVICE_ROLE_KEY ? admin : authed;
    const postIds = parsePostIds(req.query.post_ids);
    const limit = Math.max(1, Math.min(800, Number(req.query.limit || 500) || 500));

    let query = reader
      .from("sepbook_comments")
      .select("id, post_id, user_id, created_at, location_label, location_lat, location_lng, attachments")
      .not("location_lat", "is", null)
      .not("location_lng", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (postIds.length) query = query.in("post_id", postIds);

    const { data, error } = await query;
    if (error) {
      const msg = String(error.message || "");
      if (/location_(lat|lng|label)/i.test(msg) && /(column|schema cache|does not exist)/i.test(msg)) {
        return res.status(400).json({
          error:
            "Colunas de localização ainda não existem em sepbook_comments. Aplique a migração supabase/migrations/20260113143000_sepbook_comment_gps.sql.",
        });
      }
      if (/attachments/i.test(msg) && /(column|schema cache|does not exist)/i.test(msg)) {
        return res.status(400).json({
          error:
            "A coluna de anexos ainda não existe em sepbook_comments. Aplique a migração supabase/migrations/20251231180000_sepbook_comment_attachments.sql.",
        });
      }
      return res.status(400).json({ error: msg || "Falha ao carregar comentários com GPS" });
    }

    const rows = Array.isArray(data) ? data : [];
    const userIds = Array.from(new Set(rows.map((c: any) => c.user_id).filter(Boolean)));
    let profiles: any[] = [];
    try {
      const profResp = await reader
        .from("profiles")
        .select("id, name, sigla_area, avatar_url, operational_base")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
      profiles = (profResp.data as any[]) || [];
    } catch {
      profiles = [];
    }
    const profileMap = new Map<string, any>();
    profiles.forEach((p: any) => profileMap.set(p.id, p));

    const items = rows
      .map((c: any) => {
        const attachments = Array.isArray(c.attachments) ? c.attachments.filter(Boolean) : [];
        const imageUrl = attachments.find((u: any) => typeof u === "string" && isImageUrl(u)) || null;
        if (!imageUrl) return null;
        const prof = profileMap.get(c.user_id) || { name: "Colaborador", sigla_area: null, avatar_url: null, operational_base: null };
        return {
          id: c.id,
          post_id: c.post_id,
          user_id: c.user_id,
          author_name: prof.name,
          author_team: prof.sigla_area,
          author_avatar: prof.avatar_url,
          author_base: prof.operational_base || null,
          image_url: imageUrl,
          location_label: typeof c.location_label === "string" ? c.location_label : null,
          location_lat: typeof c.location_lat === "number" ? c.location_lat : null,
          location_lng: typeof c.location_lng === "number" ? c.location_lng : null,
          created_at: c.created_at,
        };
      })
      .filter(Boolean);

    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };

