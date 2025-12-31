// @ts-nocheck
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    const nowIso = new Date().toISOString();
    const { data: rows, error } = await admin
      .from("study_sources")
      .select("id, url, storage_path")
      .eq("scope", "user")
      .lt("expires_at", nowIso)
      .limit(500);
    if (error) return res.status(400).json({ error: error.message });

    const ids = (rows || []).map((r) => r.id).filter(Boolean);
    if (!ids.length) return res.status(200).json({ success: true, deleted: 0 });

    const toRemove = [];
    for (const r of rows || []) {
      const ref = r?.url ? parseStorageRefFromUrl(r.url) : null;
      if (ref) toRemove.push(ref);
      if (!ref && r?.storage_path && String(r.storage_path).includes("/")) {
        const p = String(r.storage_path);
        if (p.startsWith("study/")) {
          toRemove.push({ bucket: "evidence", path: p });
        }
      }
    }

    const grouped = new Map();
    for (const r of toRemove) {
      const list = grouped.get(r.bucket) || [];
      list.push(r.path);
      grouped.set(r.bucket, list);
    }
    for (const [bucket, paths] of grouped.entries()) {
      try {
        await admin.storage.from(bucket).remove(Array.from(new Set(paths)));
      } catch {
        // best-effort
      }
    }

    const { error: delErr } = await admin.from("study_sources").delete().in("id", ids);
    if (delErr) return res.status(400).json({ error: delErr.message });

    return res.status(200).json({ success: true, deleted: ids.length });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
