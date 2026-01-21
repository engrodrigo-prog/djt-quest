import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import exifr from "exifr";

import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import { reverseGeocodeCityLabel } from "../server/lib/reverse-geocode.js";

const ROOT = process.cwd();

const loadDotenvFile = async (filename) => {
  try {
    const full = path.join(ROOT, filename);
    const raw = await fs.readFile(full, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (!key) continue;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = value;
    }
  } catch {
    // ignore
  }
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

const clampLatLng = (latRaw, lngRaw) => {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9) return null;
  return { lat, lng };
};

const cleanUrlForExt = (raw) => String(raw || "").split("?")[0].split("#")[0];
const isPhotoUrl = (url) => /\.(png|jpe?g|webp|gif|bmp|tif|tiff|heic|heif|avif)$/i.test(cleanUrlForExt(url));

const normalizeAttachmentUrl = (raw) => {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object") {
    if (typeof raw.url === "string") return raw.url.trim();
    if (typeof raw.publicUrl === "string") return raw.publicUrl.trim();
    if (typeof raw.href === "string") return raw.href.trim();
    if (typeof raw.src === "string") return raw.src.trim();
  }
  return String(raw || "").trim();
};

const extractAttachmentUrls = (attachments) => {
  if (!attachments) return [];
  if (Array.isArray(attachments)) return attachments.map(normalizeAttachmentUrl).filter(Boolean);
  if (typeof attachments === "string") {
    const trimmed = attachments.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return extractAttachmentUrls(JSON.parse(trimmed));
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  if (typeof attachments === "object") {
    if (Array.isArray(attachments.urls)) return attachments.urls.map(normalizeAttachmentUrl).filter(Boolean);
    if (Array.isArray(attachments.items)) return attachments.items.map(normalizeAttachmentUrl).filter(Boolean);
    if (Array.isArray(attachments.files)) return attachments.files.map(normalizeAttachmentUrl).filter(Boolean);
  }
  return [];
};

export const parseStorageRefFromUrl = (supabaseUrl, raw) => {
  try {
    const base = String(supabaseUrl || "").replace(/\/+$/, "");
    if (!base) return null;
    const url = new URL(String(raw || ""));
    const p = url.pathname;
    // public object
    let m = p.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
    // signed object
    m = p.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
    // fall back for fully-qualified public URL prefix
    const prefix = `${base}/storage/v1/object/public/`;
    const href = String(url.href || "");
    if (href.startsWith(prefix)) {
      const rest = href.slice(prefix.length);
      const idx = rest.indexOf("/");
      if (idx > 0) return { bucket: rest.slice(0, idx), path: decodeURIComponent(rest.slice(idx + 1)) };
    }
    return null;
  } catch {
    return null;
  }
};

const downloadUrlAsBuffer = async (admin, supabaseUrl, rawUrl) => {
  const url = String(rawUrl || "").trim();
  if (!url) return null;
  const ref = parseStorageRefFromUrl(supabaseUrl, url);
  if (ref?.bucket && ref?.path) {
    try {
      const { data, error } = await admin.storage.from(ref.bucket).download(ref.path);
      if (error) throw error;
      const ab = await data.arrayBuffer();
      return Buffer.from(ab);
    } catch {
      // fallback to fetch below
    }
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const resp = await fetch(url, { method: "GET", signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
};

const extractGpsFromBuffer = async (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  try {
    const gps = await exifr.gps(buffer).catch(() => null);
    const lat = gps?.latitude ?? gps?.lat;
    const lng = gps?.longitude ?? gps?.lon ?? gps?.lng;
    return clampLatLng(lat, lng);
  } catch {
    return null;
  }
};

const usage = () => {
  console.log(`Usage:
  npm run sepbook:backfill:gps -- --post-id <uuid> [--apply] [--max <n>]
  npm run sepbook:backfill:gps -- --user-id <uuid> [--apply] [--max <n>]
  npm run sepbook:backfill:gps -- --all [--apply] [--max <n>]

Flags:
  --apply / --yes   Actually updates the DB (default is dry-run).
  --dry-run         Force dry-run mode.
  --max <n>         Max number of updates to apply (0 = unlimited).
  --geocode-delay-ms <ms>  Delay between reverse-geocode calls (default 1100ms).
`);
};

const main = async () => {
  await loadDotenvFile(".env");
  await loadDotenvFile(".vercel.env.local");
  await loadDotenvFile(".env.local");

  assertDjtQuestServerEnv({ requireSupabaseUrl: true });

  const args = parseArgs();
  const apply = Boolean(args["apply"] || args["yes"]);
  const dryRun = !apply || Boolean(args["dry-run"]);
  const maxItems = Number(args["max"] || 0) || 0;
  const allowAll = Boolean(args["all"]);
  const userId = typeof args["user-id"] === "string" && isUuid(args["user-id"]) ? String(args["user-id"]) : "";
  const postId = typeof args["post-id"] === "string" && isUuid(args["post-id"]) ? String(args["post-id"]) : "";
  const geocodeDelayMs = Math.max(0, Number(args["geocode-delay-ms"] || 1100) || 0);

  if (!postId && !userId && !allowAll) {
    usage();
    throw new Error("Missing scope: pass --post-id, --user-id or --all.");
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL (or VITE_SUPABASE_URL).");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const scopeLabel = postId ? `post:${postId}` : userId ? `user:${userId}` : "all";
  console.log(`Backfill SEPBook GPS from photo EXIF (${scopeLabel})${dryRun ? " [dry-run]" : ""}`);

  let scanned = 0;
  let updated = 0;
  let skippedNoPhoto = 0;
  let skippedNoExif = 0;
  let downloadFailures = 0;
  let updateFailures = 0;

  const pageSize = 50;
  for (let offset = 0; ; offset += pageSize) {
    if (maxItems && updated >= maxItems) break;

    let q = admin
      .from("sepbook_posts")
      .select("id,user_id,attachments,location_lat,location_lng,location_label,created_at")
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (postId) {
      q = q.eq("id", postId).limit(1);
    } else {
      q = q.or("location_lat.is.null,location_lng.is.null");
      if (userId) q = q.eq("user_id", userId);
    }

    const { data, error } = await q;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) break;

    for (const row of rows) {
      if (maxItems && updated >= maxItems) break;
      scanned += 1;
      const id = String(row?.id || "");
      const hasCoords = typeof row?.location_lat === "number" && typeof row?.location_lng === "number";
      if (postId && hasCoords) {
        console.log(`- ${id}: already has coords; skipping.`);
        continue;
      }

      const urls = extractAttachmentUrls(row?.attachments);
      const photos = urls.filter((u) => isPhotoUrl(u)).slice(0, 6);
      if (!photos.length) {
        skippedNoPhoto += 1;
        continue;
      }

      let coords = null;
      for (const url of photos) {
        const buffer = await downloadUrlAsBuffer(admin, supabaseUrl, url);
        if (!buffer) {
          downloadFailures += 1;
          continue;
        }
        coords = await extractGpsFromBuffer(buffer);
        if (coords) break;
      }

      if (!coords) {
        skippedNoExif += 1;
        continue;
      }

      const label = await reverseGeocodeCityLabel(coords.lat, coords.lng);
      if (geocodeDelayMs) await sleep(geocodeDelayMs);

      const patch = {
        location_lat: coords.lat,
        location_lng: coords.lng,
        location_label: label,
      };

      if (dryRun) {
        console.log(`- ${id}: would set GPS to ${coords.lat.toFixed(6)},${coords.lng.toFixed(6)} (${label || "no label"})`);
        updated += 1;
        continue;
      }

      const { error: upErr } = await admin.from("sepbook_posts").update(patch).eq("id", id);
      if (upErr) {
        updateFailures += 1;
        continue;
      }
      updated += 1;
      console.log(`- ${id}: updated GPS to ${coords.lat.toFixed(6)},${coords.lng.toFixed(6)} (${label || "no label"})`);
    }

    if (postId) break;
  }

  console.log(
    `Done. scanned=${scanned} updated=${updated} skipped(no_photo)=${skippedNoPhoto} skipped(no_exif)=${skippedNoExif} download_failures=${downloadFailures} update_failures=${updateFailures}`,
  );
};

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
