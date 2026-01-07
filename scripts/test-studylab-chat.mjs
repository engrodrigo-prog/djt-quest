#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/test-studylab-chat.mjs --text "responda apenas: ok"
 *   node scripts/test-studylab-chat.mjs --url https://djt-quest.vercel.app --mode oracle --text "ping"
 *   node scripts/test-studylab-chat.mjs --repeat 5 --text "teste"
 *   node scripts/test-studylab-chat.mjs --bearer <JWT> --text "ping"
 *   node scripts/test-studylab-chat.mjs --timeout-ms 60000 --web --text "pergunta"
 */

const args = process.argv.slice(2);
const readArg = (name, fallback = null) => {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const next = args[idx + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
};
const hasFlag = (name) => args.includes(name);

const baseUrl = String(readArg("--url", "https://djt-quest.vercel.app") || "").replace(/\/+$/, "");
const mode = String(readArg("--mode", "oracle") || "oracle").trim();
const text = String(readArg("--text", "") || "").trim();
const bearer = String(readArg("--bearer", "") || "").trim();
const repeat = Math.max(1, Math.min(50, Number(readArg("--repeat", "1") || 1)));
const useWeb = hasFlag("--web");
const timeoutMs = Math.max(1000, Math.min(180000, Number(readArg("--timeout-ms", "120000") || 120000)));

const runningUnderNodeTest = args.includes("--test") || Boolean(process.env.NODE_TEST_CONTEXT);

if (!text) {
  if (runningUnderNodeTest) {
    process.exit(0);
  }
  console.error("Missing --text");
  process.exit(2);
}

const endpoint = `${baseUrl}/api/ai?handler=study-chat`;

const safeJson = async (resp) => {
  try {
    return await resp.json();
  } catch {
    const t = await resp.text().catch(() => "");
    return { _raw: t };
  }
};

for (let i = 0; i < repeat; i += 1) {
  const t0 = Date.now();
  const headers = { "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const body = {
    mode,
    use_web: Boolean(useWeb),
    session_id: `cli_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    messages: [{ role: "user", content: text }],
  };

  let resp;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error(`[${i + 1}/${repeat}] fetch error:`, e?.message || e);
    continue;
  }

  const json = await safeJson(resp);
  const ms = Date.now() - t0;
  const ok = resp.ok && json?.success !== false;
  const answerPreview = String(json?.answer || json?.content || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const err = String(json?.error || "").trim().slice(0, 200);
  const meta = json?.meta ? JSON.stringify(json.meta) : "";

  if (ok) {
    console.log(`[${i + 1}/${repeat}] OK ${ms}ms ${meta}`);
    console.log(`  answer: ${answerPreview || "(empty)"}`);
  } else {
    console.log(`[${i + 1}/${repeat}] FAIL ${ms}ms status=${resp.status} ${meta}`);
    console.log(`  error: ${err || "(no error)"} `);
    if (json && json._raw) console.log(`  raw: ${String(json._raw).slice(0, 200)}`);
  }
}
