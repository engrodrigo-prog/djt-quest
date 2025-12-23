import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

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

const extractHashtags = (text) => {
  const s = String(text || "");
  const matches = Array.from(s.matchAll(/#([A-Za-z0-9_.-]+)/g)).map((m) =>
    String(m?.[1] || "").trim().toLowerCase(),
  );
  return Array.from(new Set(matches))
    .map((t) => t.replace(/^#+/, "").trim())
    .filter((t) => t.length >= 3 && t.length <= 50)
    .slice(0, 24);
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
  const maxPosts = Number(args["max-posts"] || 0) || 0;

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

  // Detect available columns
  let postColumns = "id, content, created_at";
  try {
    const probe = await admin.from("forum_posts").select("id, content_md").limit(1);
    if (!probe.error) postColumns = "id, content_md, content, created_at";
  } catch {
    // ignore
  }

  let processed = 0;
  let linkedRows = 0;
  let uniqueTags = 0;

  console.log(`Backfilling forum hashtags into join table${dryRun ? " [dry-run]" : ""}…`);

  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from("forum_posts")
      .select(postColumns)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) break;

    /** @type {Map<string, string[]>} */
    const tagsByPost = new Map();
    const tagSet = new Set();

    for (const row of rows) {
      if (maxPosts && processed >= maxPosts) break;
      const text = row?.content_md || row?.content || "";
      const tags = extractHashtags(text);
      processed++;
      if (!tags.length) continue;
      tagsByPost.set(String(row.id), tags);
      for (const t of tags) tagSet.add(t);
    }

    const tagsAll = Array.from(tagSet);
    uniqueTags += tagsAll.length;
    if (!tagsAll.length) {
      if (maxPosts && processed >= maxPosts) break;
      continue;
    }

    // Upsert tags and get ids
    let tagRows = [];
    if (!dryRun) {
      const up = await admin
        .from("forum_hashtags")
        .upsert(tagsAll.map((tag) => ({ tag })), { onConflict: "tag" })
        .select("id, tag");
      if (up.error) throw up.error;
      tagRows = Array.isArray(up.data) ? up.data : [];
    } else {
      const sel = await admin.from("forum_hashtags").select("id, tag").in("tag", tagsAll);
      tagRows = Array.isArray(sel.data) ? sel.data : [];
    }

    if (!tagRows.length) {
      if (maxPosts && processed >= maxPosts) break;
      continue;
    }

    const idByTag = new Map(tagRows.map((r) => [String(r.tag), String(r.id)]));

    /** @type {{post_id: string, hashtag_id: string}[]} */
    const joinRows = [];
    for (const [postId, tags] of tagsByPost.entries()) {
      for (const t of tags) {
        const hid = idByTag.get(t);
        if (!hid) continue;
        joinRows.push({ post_id: postId, hashtag_id: hid });
      }
    }

    if (!joinRows.length) {
      if (maxPosts && processed >= maxPosts) break;
      continue;
    }

    if (!dryRun) {
      for (const batch of chunk(joinRows, 800)) {
        const ins = await admin.from("forum_post_hashtags").upsert(batch, { onConflict: "post_id,hashtag_id" });
        if (ins.error) throw ins.error;
        linkedRows += batch.length;
      }
    } else {
      linkedRows += joinRows.length;
    }

    if (maxPosts && processed >= maxPosts) break;
  }

  console.log(`Posts processed: ${processed}`);
  console.log(`Unique hashtags found: ${uniqueTags}`);
  console.log(`Join rows upserted: ${linkedRows}`);
  console.log("Done.");
};

main().catch((e) => {
  console.error(e?.message || e);
  process.exitCode = 1;
});

