import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  FORUM_BASE_LOCALE,
  mergeTranslations,
  translateForumTexts,
} from "../server/lib/forum-translations.js";

const DEFAULT_TARGET_LOCALES = ["en", "zh-CN"];

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
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
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

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const needsLocale = (map, locale, opts) => {
  const obj = map && typeof map === "object" ? map : {};
  const v = obj[locale];
  if (!isNonEmptyString(v)) return true;
  if (!opts.repairDuplicates) return false;

  if (locale === FORUM_BASE_LOCALE) return false;
  const base = isNonEmptyString(obj[FORUM_BASE_LOCALE]) ? obj[FORUM_BASE_LOCALE].trim() : "";
  const cand = String(v || "").trim();
  if (!base || !cand) return false;
  // Heuristic: if translation equals base, assume it was a fallback and should be regenerated.
  return cand === base;
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const main = async () => {
  await loadDotenvFile(".env");
  await loadDotenvFile(".vercel.env.local");

  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"]);
  const repairDuplicates = args["repair-duplicates"] !== "false";
  const maxItems = Number(args["max"] || 0) || 0;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL (or VITE_SUPABASE_URL).");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (recommended).");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const opts = { repairDuplicates };
  const targetLocales = DEFAULT_TARGET_LOCALES;

  let updatedTopics = 0;
  let updatedPosts = 0;
  let updatedCompendia = 0;

  console.log(
    `Backfilling forum translations (target: ${targetLocales.join(
      ", ",
    )})${dryRun ? " [dry-run]" : ""}${repairDuplicates ? " [repair-duplicates]" : ""}`,
  );

  // 1) Topics
  {
    console.log("Scanning forum_topics…");
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .from("forum_topics")
        .select("id,title,description,title_translations,description_translations,created_at")
        .order("created_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) break;

      const tasks = [];
      for (const row of rows) {
        if (maxItems && updatedTopics >= maxItems) break;
        const needsTitle = targetLocales.some((loc) => needsLocale(row.title_translations, loc, opts));
        const needsDesc =
          isNonEmptyString(row.description) &&
          targetLocales.some((loc) => needsLocale(row.description_translations, loc, opts));
        if (!needsTitle && !needsDesc) continue;
        tasks.push({
          id: row.id,
          title: String(row.title || ""),
          description: String(row.description || ""),
          title_translations: row.title_translations,
          description_translations: row.description_translations,
          needsTitle,
          needsDesc,
        });
      }

      for (const batch of chunk(tasks, 10)) {
        const texts = [];
        const index = [];
        for (const item of batch) {
          if (item.needsTitle) {
            index.push({ kind: "title", id: item.id });
            texts.push(item.title);
          }
          if (item.needsDesc) {
            index.push({ kind: "description", id: item.id });
            texts.push(item.description);
          }
        }
        if (!texts.length) continue;

        const maps = await translateForumTexts({ texts, targetLocales, maxPerBatch: 8 });

        /** @type {Record<string, {title?: any, description?: any}>} */
        const mergedById = {};
        for (let i = 0; i < index.length; i++) {
          const meta = index[i];
          const map = maps[i] || { [FORUM_BASE_LOCALE]: texts[i] };
          if (!mergedById[meta.id]) mergedById[meta.id] = {};
          if (meta.kind === "title") mergedById[meta.id].title = map;
          if (meta.kind === "description") mergedById[meta.id].description = map;
        }

        for (const item of batch) {
          const next = mergedById[item.id] || {};
          const nextTitle = next.title
            ? mergeTranslations(
                mergeTranslations(item.title_translations, { [FORUM_BASE_LOCALE]: item.title }),
                next.title,
              )
            : mergeTranslations(item.title_translations, { [FORUM_BASE_LOCALE]: item.title });
          const nextDesc = item.description
            ? next.description
              ? mergeTranslations(
                  mergeTranslations(item.description_translations, { [FORUM_BASE_LOCALE]: item.description }),
                  next.description,
                )
              : mergeTranslations(item.description_translations, { [FORUM_BASE_LOCALE]: item.description })
            : item.description_translations;

          if (!dryRun) {
            const { error: upErr } = await admin
              .from("forum_topics")
              .update({ title_translations: nextTitle, description_translations: nextDesc })
              .eq("id", item.id);
            if (upErr) throw upErr;
          }
          updatedTopics++;
        }
      }

      if (maxItems && updatedTopics >= maxItems) break;
    }
    console.log(`forum_topics updated: ${updatedTopics}`);
  }

  // 2) Posts
  {
    console.log("Scanning forum_posts…");
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .from("forum_posts")
        .select("id,content_md,content,translations,created_at")
        .order("created_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) break;

      const tasks = rows
        .map((row) => {
          const baseText = String(row.content_md || row.content || "").trim();
          if (!baseText) return null;
          const needs = targetLocales.some((loc) => needsLocale(row.translations, loc, opts));
          if (!needs) return null;
          return { id: row.id, baseText, translations: row.translations };
        })
        .filter(Boolean);

      for (const batch of chunk(tasks, 12)) {
        const texts = batch.map((b) => b.baseText);
        const maps = await translateForumTexts({ texts, targetLocales, maxPerBatch: 8 });
        for (let i = 0; i < batch.length; i++) {
          const row = batch[i];
          const map = maps[i] || { [FORUM_BASE_LOCALE]: row.baseText };
          const merged = mergeTranslations(
            mergeTranslations(row.translations, { [FORUM_BASE_LOCALE]: row.baseText }),
            map,
          );
          if (!dryRun) {
            const { error: upErr } = await admin.from("forum_posts").update({ translations: merged }).eq("id", row.id);
            if (upErr) throw upErr;
          }
          updatedPosts++;
          if (maxItems && updatedPosts >= maxItems) break;
        }
        if (maxItems && updatedPosts >= maxItems) break;
      }

      if (maxItems && updatedPosts >= maxItems) break;
    }
    console.log(`forum_posts updated: ${updatedPosts}`);
  }

  // 3) Compendia
  {
    console.log("Scanning forum_compendia…");
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .from("forum_compendia")
        .select("topic_id,summary_md,summary_translations,closed_at")
        .order("topic_id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) break;

      const tasks = rows
        .map((row) => {
          const baseText = String(row.summary_md || "").trim();
          if (!baseText) return null;
          const needs = targetLocales.some((loc) => needsLocale(row.summary_translations, loc, opts));
          if (!needs) return null;
          return { topic_id: row.topic_id, baseText, summary_translations: row.summary_translations };
        })
        .filter(Boolean);

      for (const batch of chunk(tasks, 12)) {
        const texts = batch.map((b) => b.baseText);
        const maps = await translateForumTexts({ texts, targetLocales, maxPerBatch: 8 });
        for (let i = 0; i < batch.length; i++) {
          const row = batch[i];
          const map = maps[i] || { [FORUM_BASE_LOCALE]: row.baseText };
          const merged = mergeTranslations(
            mergeTranslations(row.summary_translations, { [FORUM_BASE_LOCALE]: row.baseText }),
            map,
          );
          if (!dryRun) {
            const { error: upErr } = await admin
              .from("forum_compendia")
              .update({ summary_translations: merged })
              .eq("topic_id", row.topic_id);
            if (upErr) throw upErr;
          }
          updatedCompendia++;
          if (maxItems && updatedCompendia >= maxItems) break;
        }
        if (maxItems && updatedCompendia >= maxItems) break;
      }

      if (maxItems && updatedCompendia >= maxItems) break;
    }
    console.log(`forum_compendia updated: ${updatedCompendia}`);
  }

  console.log("Done.");
};

main().catch((e) => {
  console.error(e?.message || e);
  process.exitCode = 1;
});
