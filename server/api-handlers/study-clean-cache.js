// @ts-nocheck
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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

const uniqueById = (rows) => {
  const out = [];
  const seen = new Set();
  for (const r of rows || []) {
    const id = r?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
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
    const baseSelect = "id, url, storage_path, is_persistent, metadata";

    const baseQuery = admin
      .from("study_sources")
      .select(baseSelect)
      .eq("user_id", uid)
      .eq("scope", "user");

    const { data: tempRows, error: tempErr } = await baseQuery.eq("is_persistent", false).limit(1000);
    if (tempErr) return res.status(400).json({ error: tempErr.message });

    const { data: chatRows, error: chatErr } = await baseQuery.eq("metadata->>source", "study_chat").limit(1000);
    if (chatErr && !/column/i.test(String(chatErr.message || chatErr))) {
      return res.status(400).json({ error: chatErr.message });
    }

    const rows = uniqueById([...(tempRows || []), ...(chatRows || [])]);
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (!ids.length) return res.status(200).json({ success: true, deleted: 0, storage_deleted: 0 });

    const toRemove = [];
    for (const r of rows || []) {
      const ref = r?.url ? parseStorageRefFromUrl(r.url) : null;
      if (ref) {
        toRemove.push(ref);
        continue;
      }
      const sp = String(r?.storage_path || "");
      if (sp && sp.includes("/") && (sp.startsWith("study/") || sp.startsWith("study-chat/"))) {
        toRemove.push({ bucket: "evidence", path: sp });
      }
    }

    let removedCount = 0;
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
        removedCount += uniq.length;
      } catch {
        // best-effort
      }
    }

    const { error: delErr } = await admin.from("study_sources").delete().in("id", ids);
    if (delErr) return res.status(400).json({ error: delErr.message });

    return res.status(200).json({ success: true, deleted: ids.length, storage_deleted: removedCount });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
