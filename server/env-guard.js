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
    throw new Error(`Invalid ${envName}: ${rawUrl}`);
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

  const candidates = [
    { envName: "SUPABASE_URL", value: process.env.SUPABASE_URL },
    { envName: "VITE_SUPABASE_URL", value: process.env.VITE_SUPABASE_URL },
    { envName: "NEXT_PUBLIC_SUPABASE_URL", value: process.env.NEXT_PUBLIC_SUPABASE_URL },
  ];

  if (requireSupabaseUrl && candidates.every((c) => !c.value)) {
    throw new Error("Missing SUPABASE_URL (ou VITE_SUPABASE_URL) no ambiente do backend.");
  }

  for (const c of candidates) {
    if (!c.value) continue;
    assertDjtQuestSupabaseUrl(c.value, { allowLocal, envName: c.envName });
  }
};

