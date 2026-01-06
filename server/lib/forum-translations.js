import OpenAI from "openai";

const SUPPORTED_LOCALES = ["pt-BR", "en", "zh-CN"];
// We always target all supported locales. Source language is auto-detected per text.
const DEFAULT_TARGET_LOCALES = [...SUPPORTED_LOCALES];

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const pickModel = () =>
  process.env.OPENAI_MODEL_FAST ||
  process.env.OPENAI_MODEL_PREMIUM ||
  process.env.OPENAI_TEXT_MODEL ||
  "gpt-4.1-mini";

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const normalizeLocales = (raw) => {
  if (!raw) return [...DEFAULT_TARGET_LOCALES];
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => SUPPORTED_LOCALES.includes(v));
  }
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v || "").trim()).filter((v) => SUPPORTED_LOCALES.includes(v));
  }
  return [...DEFAULT_TARGET_LOCALES];
};

export async function translateForumTexts(params) {
  const texts = Array.isArray(params?.texts) ? params.texts.map((t) => String(t ?? "")) : [];
  const locales = Array.from(new Set(normalizeLocales(params?.targetLocales)));
  const maxPerBatch = Math.max(3, Math.min(12, Number(params?.maxPerBatch || 10)));

  const output = texts.map((txt) => {
    const base = String(txt ?? "");
    const map = {};
    for (const loc of locales) map[loc] = base;
    return map;
  });
  const tasks = texts
    .map((text, idx) => ({ idx, text: String(text || "").slice(0, 6000).trim() }))
    .filter((t) => t.text.length > 0);

  if (!tasks.length) return output;
  if (!client) return output;

  const prompt =
    `Você traduz textos da DJT Quest para múltiplos idiomas (${locales.join(", ")}).\n` +
    `Regras:\n` +
    `- Detecte automaticamente o idioma do texto de entrada (pode estar em pt-BR, en, zh-CN ou misturado).\n` +
    `- Preserve markdown, hashtags (#tag), menções (@pessoa ou @equipe), campanhas (&"Nome da Campanha") e emojis.\n` +
    `- Mantenha o sentido técnico/profissional; não acrescente comentários.\n` +
    `- Se o texto já estiver em algum idioma alvo, reutilize-o (sem inventar tradução literal).\n` +
    `Retorne SOMENTE JSON: {"translations":[{ "${locales.join('":"...","')}" : "..." }]} no mesmo tamanho e ordem.\n` +
    `- Preencha TODAS as chaves de idioma; se não souber, repita o texto de entrada.`;

  for (const batch of chunkArray(tasks, maxPerBatch)) {
    try {
      const completion = await client.chat.completions.create({
        model: pickModel(),
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: JSON.stringify({ locales, texts: batch.map((b) => b.text) }) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 3500,
      });

      let parsed = {};
      try {
        parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
      } catch {
        parsed = {};
      }
      const translations = Array.isArray(parsed?.translations) ? parsed.translations : [];
      batch.forEach((task, idx) => {
        const candidate = translations[idx] || {};
        const merged = {};
        for (const loc of locales) {
          const val = typeof candidate[loc] === "string" ? candidate[loc].trim() : "";
          merged[loc] = val || task.text || "";
        }
        output[task.idx] = merged;
      });
    } catch (e) {
      // fallback handled by default output
      console.error("translateForumTexts batch failed", e?.message || e);
    }
  }

  return output;
}

export function mergeTranslations(existing, next) {
  const cur = typeof existing === "object" && existing !== null ? existing : {};
  const out = { ...cur };
  if (typeof next !== "object" || next === null) return out;
  for (const key of Object.keys(next)) {
    const value = next[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = value;
    }
  }
  return out;
}

export function localesForAllTargets(raw) {
  const target = normalizeLocales(raw);
  const set = new Set([...DEFAULT_TARGET_LOCALES, ...target]);
  return Array.from(set).filter((loc) => SUPPORTED_LOCALES.includes(loc));
}

export const FORUM_SUPPORTED_LOCALES = SUPPORTED_LOCALES;
export const FORUM_BASE_LOCALE = "pt-BR";
