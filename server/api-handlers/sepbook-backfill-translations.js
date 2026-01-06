import { createClient } from "@supabase/supabase-js";
import { localesForAllTargets, mergeTranslations, translateForumTexts } from "../lib/forum-translations.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const parseBool = (v) => {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
};
const needsLocales = (map, locales, force = false) => {
  if (force) return true;
  if (!locales || locales.length === 0) return false;
  const obj = map && typeof map === "object" ? map : {};
  return locales.some((loc) => typeof obj[loc] !== "string" || obj[loc].trim().length === 0);
};
const clampLimit = (v, def, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
};
async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const authHeader = req.headers["authorization"] || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.slice(7);
    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    let isStaff = false;
    try {
      const { data: staffFlag, error } = await admin.rpc("is_staff", { u: uid });
      if (!error) isStaff = Boolean(staffFlag);
    } catch {
    }
    if (!isStaff) return res.status(403).json({ error: "Forbidden" });
    const targetLocales = localesForAllTargets(req.body?.locales || req.query?.locales);
    const force = parseBool(req.body?.force || req.query?.force);
    const dryRun = parseBool(req.body?.dryRun || req.query?.dryRun);
    const limitPosts = clampLimit(req.body?.limitPosts || req.query?.limitPosts || req.body?.limit, 60, 250);
    const limitComments = clampLimit(req.body?.limitComments || req.query?.limitComments || req.body?.limit, 120, 400);
    const [{ data: posts, error: postsErr }, { data: comments, error: commentsErr }] = await Promise.all([
      admin.from("sepbook_posts").select("id,content_md,translations").order("created_at", { ascending: true }).limit(limitPosts),
      admin.from("sepbook_comments").select("id,content_md,translations").order("created_at", { ascending: true }).limit(limitComments)
    ]);
    const schemaError = (postsErr || commentsErr)?.message || "";
    if (/column .*translations.* does not exist/i.test(schemaError)) {
      return res.status(500).json({
        error: "Missing translations column. Apply migration supabase/migrations/20260101130000_sepbook_translations.sql"
      });
    }
    if (postsErr) return res.status(400).json({ error: postsErr.message });
    if (commentsErr) return res.status(400).json({ error: commentsErr.message });
    const postTasks = (Array.isArray(posts) ? posts : []).filter((p) => needsLocales(p?.translations, targetLocales, force) && String(p?.content_md || "").trim()).slice(0, limitPosts).map((p) => ({ id: p.id, text: String(p.content_md || ""), translations: p.translations }));
    const commentTasks = (Array.isArray(comments) ? comments : []).filter((c) => needsLocales(c?.translations, targetLocales, force) && String(c?.content_md || "").trim()).slice(0, limitComments).map((c) => ({ id: c.id, text: String(c.content_md || ""), translations: c.translations }));
    const postMaps = postTasks.length ? await translateForumTexts({ texts: postTasks.map((t) => t.text), targetLocales, maxPerBatch: 8 }) : [];
    const commentMaps = commentTasks.length ? await translateForumTexts({ texts: commentTasks.map((t) => t.text), targetLocales, maxPerBatch: 8 }) : [];
    let postsUpdated = 0;
    let commentsUpdated = 0;
    if (!dryRun) {
      for (let i = 0; i < postTasks.length; i++) {
        const t = postTasks[i];
        const map = postMaps[i] || { "pt-BR": t.text };
        const next = force ? map : mergeTranslations(t.translations, map);
        try {
          await admin.from("sepbook_posts").update({ translations: next }).eq("id", t.id);
          postsUpdated++;
        } catch {
        }
      }
      for (let i = 0; i < commentTasks.length; i++) {
        const t = commentTasks[i];
        const map = commentMaps[i] || { "pt-BR": t.text };
        const next = force ? map : mergeTranslations(t.translations, map);
        try {
          await admin.from("sepbook_comments").update({ translations: next }).eq("id", t.id);
          commentsUpdated++;
        } catch {
        }
      }
    }
    return res.status(200).json({
      success: true,
      dryRun,
      force,
      targetLocales,
      posts: { scanned: Array.isArray(posts) ? posts.length : 0, candidates: postTasks.length, updated: dryRun ? 0 : postsUpdated },
      comments: {
        scanned: Array.isArray(comments) ? comments.length : 0,
        candidates: commentTasks.length,
        updated: dryRun ? 0 : commentsUpdated
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}
const config = { api: { bodyParser: { sizeLimit: "2mb" } } };
export {
  config,
  handler as default
};
