import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const ROOT = process.cwd();

const LOCALES = [
  { locale: "pt-BR", file: path.join(ROOT, "locales", "pt-BR.json") },
  { locale: "en", file: path.join(ROOT, "locales", "en.json") },
  { locale: "zh-CN", file: path.join(ROOT, "locales", "zh-CN.json") },
];

const TARGETS = new Set(["en", "zh-CN"]);

const loadEnvFromFile = async (file) => {
  try {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (!key || process.env[key]) continue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // ignore missing env files
  }
};

const loadEnv = async () => {
  await loadEnvFromFile(path.join(ROOT, ".env"));
  await loadEnvFromFile(path.join(ROOT, ".env.local"));
  await loadEnvFromFile(path.join(ROOT, ".vercel.env.local"));
};

const isPlainObject = (value) => {
  if (!value || typeof value !== "object") return false;
  return Object.prototype.toString.call(value) === "[object Object]";
};

const flattenLeaves = (obj, prefix = "") => {
  if (!isPlainObject(obj)) throw new Error(`Expected object at "${prefix || "<root>"}"`);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out[nextKey] = v;
      continue;
    }
    if (isPlainObject(v)) {
      Object.assign(out, flattenLeaves(v, nextKey));
      continue;
    }
    throw new Error(`Invalid value type at "${nextKey}": expected string or object`);
  }
  return out;
};

const setNested = (obj, dottedKey, value) => {
  const parts = dottedKey.split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const isLast = i === parts.length - 1;
    if (isLast) {
      cur[p] = value;
      return;
    }
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const targetLabel = (locale) => {
  if (locale === "en") return "English";
  if (locale === "zh-CN") return "Simplified Chinese (zh-CN)";
  return locale;
};

const main = async () => {
  await loadEnv();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY (checked .env, .env.local, .vercel.env.local).");
    process.exitCode = 1;
    return;
  }

  const model =
    process.env.OPENAI_MODEL_FAST ||
    process.env.OPENAI_MODEL_PREMIUM ||
    process.env.OPENAI_TEXT_MODEL ||
    "gpt-5.2-fast";

  const client = new OpenAI({ apiKey });

  const parsedByLocale = {};
  for (const { locale, file } of LOCALES) {
    const raw = await fs.readFile(file, "utf8");
    parsedByLocale[locale] = JSON.parse(raw);
  }

  const base = parsedByLocale["pt-BR"];
  const flatBase = flattenLeaves(base);

  for (const { locale } of LOCALES) {
    if (!TARGETS.has(locale)) continue;
    const targetObj = parsedByLocale[locale];
    const flatTarget = flattenLeaves(targetObj);

    const pendingKeys = Object.keys(flatBase).filter(
      (k) => typeof flatBase[k] === "string" && flatBase[k].trim() && flatTarget[k] === "",
    );
    if (!pendingKeys.length) continue;

    console.log(`[${locale}] translating ${pendingKeys.length} empty string(s) using ${model}…`);

    for (const keysChunk of chunk(pendingKeys, 40)) {
      const input = Object.fromEntries(keysChunk.map((k) => [k, flatBase[k]]));

      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              `Translate Brazilian Portuguese UI strings into ${targetLabel(locale)}.\n` +
              `Return ONLY valid JSON (object) mapping the SAME keys to translated strings.\n` +
              `Rules: preserve placeholders like {name}; keep punctuation; do not add extra keys; no markdown.`,
          },
          { role: "user", content: JSON.stringify(input) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });

      const content = completion.choices?.[0]?.message?.content || "{}";
      let parsed = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error(`OpenAI returned non-JSON for ${locale}`);
      }

      for (const k of keysChunk) {
        const v = parsed[k];
        if (typeof v !== "string") continue;
        setNested(targetObj, k, v);
      }
    }

    await fs.writeFile(
      LOCALES.find((x) => x.locale === locale).file,
      JSON.stringify(targetObj, null, 2) + "\n",
      "utf8",
    );
  }
};

main().catch((e) => {
  console.error(e?.message || e);
  process.exitCode = 1;
});
