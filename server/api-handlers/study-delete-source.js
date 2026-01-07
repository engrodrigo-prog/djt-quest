// @ts-nocheck
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const parseStorageRefFromUrl = (raw) => {
  try {
    const url = new URL(raw);
    const path = url.pathname;
    let m = path.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
    m = path.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
    return null;
  } catch {
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Missing Supabase server configuration" });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Unauthorized" });
    const uid = userData.user.id;

    const sourceId =
      (req.body && (req.body.source_id || req.body.id)) ||
      (typeof req.query.source_id === "string" ? req.query.source_id : null) ||
      (typeof req.query.id === "string" ? req.query.id : null);
    if (!sourceId || typeof sourceId !== "string") {
      return res.status(400).json({ error: "source_id required" });
    }

    const { data: row, error: rowErr } = await admin
      .from("study_sources")
      .select("id, user_id, scope, published, url, storage_path, metadata")
      .eq("id", sourceId)
      .maybeSingle();
    if (rowErr) return res.status(400).json({ error: rowErr.message });
    if (!row) return res.status(404).json({ error: "Not found" });

    const isOwner = row.user_id && row.user_id === uid;
    let staff = false;
    try {
      const { data } = await admin.rpc("is_staff", { u: uid });
      staff = Boolean(data);
    } catch {
      staff = false;
    }
    if (!isOwner && !staff) return res.status(403).json({ error: "Forbidden" });

    const toRemove = [];
    const ref = row?.url ? parseStorageRefFromUrl(row.url) : null;
    if (ref) toRemove.push(ref);
    const sp = String(row?.storage_path || "");
    if (!ref && sp && sp.includes("/") && (sp.startsWith("study/") || sp.startsWith("study-chat/"))) {
      toRemove.push({ bucket: "evidence", path: sp });
    }

    const grouped = new Map();
    for (const r of toRemove) {
      const list = grouped.get(r.bucket) || [];
      list.push(r.path);
      grouped.set(r.bucket, list);
    }
    for (const [bucket, paths] of grouped.entries()) {
      try {
        const uniq = Array.from(new Set(paths));
        if (!uniq.length) continue;
        await admin.storage.from(bucket).remove(uniq);
      } catch {
        // best-effort
      }
    }

    const { error: delErr } = await admin.from("study_sources").delete().eq("id", sourceId);
    if (delErr) return res.status(400).json({ error: delErr.message });

    return res.status(200).json({ success: true, deleted: 1 });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };

