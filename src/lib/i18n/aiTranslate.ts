import { apiFetch } from "@/lib/api";
import type { Locale } from "@/contexts/I18nContext";

const CACHE_PREFIX = "djt_tr";

const hashFNV1a = (str: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const cacheKey = (targetLocale: string, text: string) => `${CACHE_PREFIX}:${targetLocale}:${hashFNV1a(text)}`;

const readCache = (key: string): string | null => {
  try {
    const v = localStorage.getItem(key);
    if (!v) return null;
    const parsed = JSON.parse(v);
    if (typeof parsed?.t === "string") return parsed.t;
  } catch {
    // ignore
  }
  return null;
};

const writeCache = (key: string, translated: string) => {
  try {
    localStorage.setItem(key, JSON.stringify({ t: translated, at: Date.now() }));
  } catch {
    // ignore
  }
};

export async function translateTextsCached(params: {
  targetLocale: Locale;
  texts: string[];
}): Promise<string[]> {
  const targetLocale = params.targetLocale;
  const texts = params.texts.map((t) => String(t || ""));

  if (targetLocale === "pt-BR") return texts;

  const cached: Array<string | null> = texts.map((t) => readCache(cacheKey(targetLocale, t)));
  const missingIdx = cached
    .map((v, idx) => (v == null && texts[idx].trim() ? idx : -1))
    .filter((idx) => idx >= 0);

  if (missingIdx.length === 0) return cached.map((v, i) => v ?? texts[i]);

  // Avoid huge payloads; keep ordering for filled subset.
  const missingTexts = missingIdx.map((idx) => texts[idx]).slice(0, 60);

  try {
    const resp = await apiFetch("/api/ai?handler=translate-text", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-UI": "silent" },
      body: JSON.stringify({ targetLocale, texts: missingTexts }),
    });
    const json = await resp.json().catch(() => ({} as any));
    if (!resp.ok) throw new Error((json as any)?.error || "Translation failed");

    const warning = (json as any)?.meta?.warning ? String((json as any).meta.warning) : "";
    if (warning) {
      // Do not cache fallbacks (otherwise we'd permanently cache the original text as "translated").
      return texts.map((t, i) => cached[i] ?? t);
    }

    const translations: string[] = Array.isArray(json?.translations) ? json.translations.map((x: any) => String(x || "")) : [];
    for (let i = 0; i < missingTexts.length; i++) {
      const original = missingTexts[i];
      const translated = translations[i] || original;
      writeCache(cacheKey(targetLocale, original), translated);
    }
  } catch {
    // Silent fallback: return cached where available, otherwise original text.
    return texts.map((t, i) => cached[i] ?? t);
  }

  // Re-read cache to ensure hash collisions don't propagate wrong content.
  return texts.map((t) => readCache(cacheKey(targetLocale, t)) ?? t);
}
