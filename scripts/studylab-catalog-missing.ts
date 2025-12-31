#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const FIXED_RULES_ID = "fixed:djt-quest-rules";
const BATCH_SIZE = 200;
const CONCURRENCY = 2;

function loadDotEnvIfPresent() {
  try {
    const envPath = path.resolve(".env");
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf-8");
    content.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) return;
      const key = m[1];
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    });
  } catch {}
}

function needsCataloging(source: any) {
  if (!source || source.id === FIXED_RULES_ID) return false;
  if (source.ingest_status !== "ok") return true;
  if (!String(source.title || "").trim() || !String(source.summary || "").trim()) return true;
  const meta = source.metadata && typeof source.metadata === "object" ? source.metadata : null;
  const outline = meta?.ai?.outline || meta?.outline;
  if (!Array.isArray(outline) || outline.length === 0) return true;
  return false;
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function main() {
  loadDotEnvIfPresent();
  process.env.DJT_ALLOW_DEV_INGEST = process.env.DJT_ALLOW_DEV_INGEST || "1";

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { default: aiStudyChat } = await import("../server/api-handlers/ai-study-chat.ts");

  let offset = 0;
  const all: any[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("study_sources")
      .select("id, title, summary, ingest_status, ingest_error, metadata, created_at, url, kind, storage_path, full_text")
      .order("created_at", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < BATCH_SIZE) break;
    offset += rows.length;
  }

  const targets = all.filter(needsCataloging);
  console.log(`Found ${targets.length} sources to catalog.`);
  if (!targets.length) return;

  let idx = 0;
  let done = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  const worker = async () => {
    while (idx < targets.length) {
      const current = targets[idx++];
      const sourceId = current.id;
      const req: any = {
        method: "POST",
        headers: {},
        query: {},
        body: { mode: "ingest", source_id: sourceId },
      };
      const res = createMockRes();
      try {
        await aiStudyChat(req, res);
        const body = res.body || {};
        if (body?.success && body?.ingested) {
          ok += 1;
        } else {
          skipped += 1;
          const fullTextLen = String(current.full_text || "").length;
          console.log(
            `[skip] ${sourceId} url=${current.url || "-"} kind=${current.kind || "-"} storage_path=${current.storage_path || "-"} full_text_len=${fullTextLen} ingest_status=${current.ingest_status || "-"} ingest_error=${current.ingest_error || "-"}`
          );
        }
      } catch (err: any) {
        failed += 1;
        console.error(`[ingest error] ${sourceId}:`, err?.message || err);
      } finally {
        done += 1;
        console.log(`[${done}/${targets.length}] ${sourceId}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`Catalog complete. ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
