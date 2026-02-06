import OpenAI from "openai";
import { loadLocalEnvIfNeeded } from "../lib/load-local-env.js";
import { normalizeChatModel } from "../lib/openai-models.js";
loadLocalEnvIfNeeded();
const systemPrompt = `
Voc\xEA \xE9 um assistente de hashtag PT-BR. Gere 5 hashtags curtas (sem espa\xE7os) baseadas no texto fornecido.
Regras:
- S\xF3 corrija ortografia da hashtag, n\xE3o mude o sentido.
- Use no m\xE1ximo 3 palavras por hashtag (separadas por underscore ou tudo junto).
- Prefira termos j\xE1 citados no texto, campanhas ou temas t\xE9cnicos.
- Responda apenas em JSON: {"hashtags": ["#tag1", "#tag2", ...]}.
`;
const STOPWORDS = /* @__PURE__ */ new Set([
  "para",
  "com",
  "sem",
  "entre",
  "sobre",
  "quanto",
  "como",
  "quando",
  "onde",
  "porque",
  "por",
  "uma",
  "uns",
  "umas",
  "que",
  "n\xE3o",
  "nao",
  "sim",
  "mais",
  "menos",
  "ser",
  "ter",
  "seu",
  "sua",
  "seus",
  "suas",
  "nos",
  "nas",
  "dos",
  "das",
  "aos",
  "as",
  "os",
  "ao",
  "de",
  "da",
  "do",
  "e",
  "o",
  "a"
]);
const normalizeToken = (raw) => raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").trim();
const extractExistingHashtags = (text) => {
  const matches = Array.from(String(text || "").matchAll(/#([A-Za-z0-9_.-]+)/g)).map((m) => `#${m[1]}`);
  const uniq = Array.from(new Set(matches.map((t) => t.trim()).filter(Boolean)));
  return uniq.slice(0, 5);
};
const buildFallbackHashtags = (text) => {
  const existing = extractExistingHashtags(text);
  if (existing.length) return existing;
  const counts = /* @__PURE__ */ new Map();
  const tokens = String(text || "").split(/\s+/).map((t) => normalizeToken(t)).filter((t) => t.length >= 4 && t.length <= 18 && !STOPWORDS.has(t));
  for (const t of tokens) {
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => `#${t}`);
  if (top.length) return top;
  return ["#inovacao", "#seguranca", "#prontidao", "#time", "#execucao"];
};
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { text } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 5) {
    return res.status(400).json({ error: "text is required" });
  }
  try {
    const key = String(process.env.OPENAI_API_KEY || "").trim();
    const client = key ? new OpenAI({ apiKey: key }) : null;
    if (!client) {      return res.status(200).json({ hashtags: buildFallbackHashtags(text), meta: { warning: "OPENAI_API_KEY ausente" } });
    }
    const model = normalizeChatModel(process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_PREMIUM_MODEL || process.env.OPENAI_MODEL_FAST || process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini", "gpt-4.1-mini");
    const payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text.slice(0, 6e3) }
      ],
      response_format: { type: "json_object" }
    };
    if (/^gpt-5/i.test(String(model))) payload.max_completion_tokens = 200;
    else payload.max_tokens = 200;
    const completion = await client.chat.completions.create(payload);
    const raw = completion.choices[0]?.message?.content && (Array.isArray(completion.choices[0].message.content) ? completion.choices[0].message.content[0].text : completion.choices[0].message.content);
    let hashtags = [];
    try {
      const parsed = JSON.parse(raw || "{}");
      if (Array.isArray(parsed.hashtags)) {
        hashtags = parsed.hashtags.map((s) => String(s || "").trim()).filter((s) => s.startsWith("#") && s.length >= 2).slice(0, 5);
      }
    } catch {
    }
    if (hashtags.length === 0) {
      return res.status(200).json({ hashtags: buildFallbackHashtags(text) });
    }
    return res.status(200).json({ hashtags });
  } catch (e) {
    console.error("ai-suggest-hashtags error", e);
    const message = String(e?.message || "Falha ao sugerir hashtags");
    const warning = /(invalid[_\s-]?api[_\s-]?key|incorrect\s+api\s+key)/i.test(message) ? "OPENAI_API_KEY inválida ou revogada" : message;
    return res.status(200).json({ hashtags: buildFallbackHashtags(text), meta: { warning } });
  }
}
export {
  handler as default
};
