import OpenAI from "openai";
const pickModel = () => process.env.OPENAI_MODEL_FAST || process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_TEXT_MODEL || "gpt-5-2025-08-07";
const normalizeTarget = (value) => {
  const v = String(value || "").trim();
  if (!v) return "pt-BR";
  return v;
};
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = req.body || {};
  const targetLocale = normalizeTarget(body.targetLocale);
  const textsRaw = body.texts;
  if (!Array.isArray(textsRaw)) return res.status(400).json({ error: "texts must be an array" });
  const texts = textsRaw.map((t) => typeof t === "string" ? t : "").map((t) => t.trim()).filter(Boolean).slice(0, 60);
  if (!texts.length) return res.status(200).json({ translations: [] });
  if (targetLocale === "pt-BR") return res.status(200).json({ translations: texts });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      translations: texts,
      meta: { warning: "OPENAI_API_KEY ausente (tradu\xE7\xE3o desabilitada no servidor)." }
    });
  }
  const prompt = `Translate UI/content strings to locale "${targetLocale}".
Source text may be Portuguese, English, or Chinese, and may be mixed.
Preserve meaning and tone.
Rules:
- Keep placeholders like {name} intact.
- Preserve markdown, hashtags (#tag), mentions (@user or @team), campaign markers (&"Campaign Name"), emojis, and punctuation.
- If a string is already in the target locale, reuse it (do not force literal translation).
- Do not add explanations.
Return ONLY JSON: {"translations": ["..."]} with same length and order.`;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = pickModel();
    const payload = {
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify({ targetLocale, texts }) }
      ],
      response_format: { type: "json_object" }
    };
    if (/^gpt-5/i.test(String(model))) payload.max_completion_tokens = 1500;
    else payload.max_tokens = 1500;
    const completion = await client.chat.completions.create(payload);
    const raw = completion.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    const translations = Array.isArray(parsed?.translations) ? parsed.translations.map((x) => String(x || "").trim()) : [];
    const out = texts.map((t, i) => translations[i] || t);
    return res.status(200).json({ translations: out });
  } catch (e) {
    console.error("ai-translate-text error", e);
    return res.status(200).json({
      translations: texts,
      meta: { warning: e?.message || "Falha ao traduzir texto" }
    });
  }
}
export {
  handler as default
};
