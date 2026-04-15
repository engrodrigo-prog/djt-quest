// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import { normalizeLatLng, reverseGeocodeCityLabel } from "../server/lib/reverse-geocode.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });

    // Requerer autenticacao para evitar uso como open proxy do geocoder
    const authHeader = (req.headers["authorization"] as string | undefined) || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    if (SUPABASE_URL && SUPABASE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: me, error: meErr } = await supabase.auth.getUser(token);
      if (meErr || !me?.user) return res.status(401).json({ error: "Unauthorized" });
    }

    const lat = req.query.lat;
    const lng = req.query.lng;
    const coords = normalizeLatLng(lat, lng);
    if (!coords) return res.status(400).json({ error: "Invalid lat/lng" });

    const label = await reverseGeocodeCityLabel(coords.lat, coords.lng);
    // Cache privado: resultado vinculado ao usuario autenticado, nao deve ser
    // compartilhado entre requests de usuarios diferentes via CDN.
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.status(200).json({
      success: true,
      lat: coords.lat,
      lng: coords.lng,
      label,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };

