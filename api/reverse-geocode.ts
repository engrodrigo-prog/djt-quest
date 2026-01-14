// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import { normalizeLatLng, reverseGeocodeCityLabel } from "../server/lib/reverse-geocode.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });

    const lat = req.query.lat;
    const lng = req.query.lng;
    const coords = normalizeLatLng(lat, lng);
    if (!coords) return res.status(400).json({ error: "Invalid lat/lng" });

    const label = await reverseGeocodeCityLabel(coords.lat, coords.lng);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
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

