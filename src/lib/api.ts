import { supabase } from '@/integrations/supabase/client';
import { aiProgressStore } from "@/lib/aiProgress";

const rawBase = import.meta.env.VITE_API_BASE_URL?.trim();
const sanitizedBase =
  rawBase && rawBase.length > 1
    ? rawBase.replace(/\/+$/, '')
    : '';

export const apiBaseUrl = sanitizedBase;

export const apiUrl = (path: string) => {
  if (!sanitizedBase) return path;
  return `${sanitizedBase}${path.startsWith('/') ? path : `/${path}`}`;
};

const getAiTaskKey = (url: URL, init?: RequestInit) => {
  if (!url.pathname.startsWith("/api/ai")) return null;
  const handler = url.searchParams.get("handler") || "ai";
  let taskKey = handler;
  try {
    const body = init?.body;
    if (handler === "study-chat" && typeof body === "string") {
      const parsed = JSON.parse(body);
      if (parsed?.mode === "ingest") taskKey = "study-chat:ingest";
    }
  } catch {
    // ignore
  }
  return { handler, taskKey };
};

export async function apiFetch(input: string, init?: RequestInit) {
  const uiHeaders = new Headers(init?.headers || {});
  const uiModeRaw = (uiHeaders.get("X-AI-UI") || "").trim().toLowerCase();
  const uiSilent = uiModeRaw === "silent" || uiModeRaw === "0" || uiModeRaw === "false" || uiModeRaw === "off";

  const urlForMeta = (() => {
    try {
      const full = apiUrl(input);
      return new URL(full, globalThis.location?.origin || "http://localhost");
    } catch {
      return null;
    }
  })();
  const aiMeta = urlForMeta ? getAiTaskKey(urlForMeta, init) : null;
  const aiTaskId = aiMeta && !uiSilent ? aiProgressStore.startTask(aiMeta) : null;

  const headers = new Headers(init?.headers || {});

  if (!headers.has('Authorization')) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    } catch {
      // Ignore errors fetching session; request proceeds unauthenticated
    }
  }

  try {
    return await fetch(apiUrl(input), { ...init, headers });
  } finally {
    if (aiTaskId) aiProgressStore.endTask(aiTaskId);
  }
}
