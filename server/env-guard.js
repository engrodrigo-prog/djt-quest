import { getSupabaseUrlFromEnv } from "./lib/supabase-url.js";
import { normalizeChatModel } from "./lib/openai-models.js";

export const DJT_QUEST_SUPABASE_PROJECT_REF = "eyuehdefoedxcunxiyvb";
export const DJT_QUEST_SUPABASE_HOST = `${DJT_QUEST_SUPABASE_PROJECT_REF}.supabase.co`;

const isLocalHostname = (hostname) => hostname === "localhost" || hostname === "127.0.0.1";

export const assertDjtQuestSupabaseUrl = (rawUrl, opts = {}) => {
  const { allowLocal = true, envName = "SUPABASE_URL" } = opts;

  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error(`Missing ${envName}`);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Accept values without protocol, e.g. "project-ref.supabase.co"
    try {
      parsed = new URL(`https://${String(rawUrl).trim()}`);
    } catch {
      throw new Error(`Invalid ${envName}: ${rawUrl}`);
    }
  }

  const hostname = parsed.hostname;
  if (allowLocal && isLocalHostname(hostname)) return;
  if (hostname === DJT_QUEST_SUPABASE_HOST) return;

  throw new Error(
    `${envName} aponta para um Supabase inesperado (${hostname}). Este projeto deve usar ${DJT_QUEST_SUPABASE_HOST}.`,
  );
};

export const assertDjtQuestServerEnv = (opts = {}) => {
  const { requireSupabaseUrl = false, allowLocal = true } = opts;

  // Normalize OpenAI model aliases (e.g., gpt-5 -> snapshot) so downstream handlers are consistent.
  const normalizeEnvModel = (key) => {
    const raw = process.env[key];
    if (!raw || typeof raw !== "string") return;
    const normalized = normalizeChatModel(raw, raw);
    process.env[key] = normalized;
  };

  normalizeEnvModel("OPENAI_MODEL_FAST");
  normalizeEnvModel("OPENAI_MODEL_PREMIUM");
  normalizeEnvModel("OPENAI_MODEL_STUDYLAB_CHAT");
  normalizeEnvModel("OPENAI_TEXT_MODEL");
  normalizeEnvModel("OPENAI_MODEL_OVERRIDE");

  const resolved = getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal });

  if (requireSupabaseUrl && !resolved) {
    throw new Error("Missing SUPABASE_URL (ou VITE_SUPABASE_URL) no ambiente do backend.");
  }

  if (resolved) {
    assertDjtQuestSupabaseUrl(resolved, { allowLocal, envName: "SUPABASE_URL" });
  }
};
