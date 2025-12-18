import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const LOCALE_FILES = [
  { locale: "pt-BR", file: path.join(ROOT, "locales", "pt-BR.json") },
  { locale: "en", file: path.join(ROOT, "locales", "en.json") },
  { locale: "zh-CN", file: path.join(ROOT, "locales", "zh-CN.json") },
];

const isPlainObject = (value) => {
  if (!value || typeof value !== "object") return false;
  return Object.prototype.toString.call(value) === "[object Object]";
};

const flattenLeaves = (obj, prefix = "") => {
  if (!isPlainObject(obj)) throw new Error(`Expected object at "${prefix || "<root>"}"`);

  /** @type {Record<string, string>} */
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

const extractPlaceholders = (value) => {
  const matches = value.matchAll(/\{(\w+)\}/g);
  return new Set(Array.from(matches, (m) => m[1]));
};

const setEq = (a, b) => {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
};

const setToSortedArray = (s) => Array.from(s).sort();

const main = async () => {
  /** @type {Record<string, Record<string, string>>} */
  const maps = {};

  for (const { locale, file } of LOCALE_FILES) {
    const raw = await fs.readFile(file, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON for ${locale}: ${file}\n${e?.message || e}`);
    }
    maps[locale] = flattenLeaves(parsed);
  }

  const base = maps["pt-BR"];
  if (!base) throw new Error("Missing pt-BR locale map");

  /** @type {string[]} */
  const errors = [];

  const allKeySets = Object.fromEntries(
    Object.entries(maps).map(([locale, dict]) => [locale, new Set(Object.keys(dict))]),
  );

  const baseKeys = allKeySets["pt-BR"];
  for (const [locale, keys] of Object.entries(allKeySets)) {
    const missing = new Set([...baseKeys].filter((k) => !keys.has(k)));
    const extra = new Set([...keys].filter((k) => !baseKeys.has(k)));
    if (missing.size) {
      errors.push(`[${locale}] Missing keys: ${setToSortedArray(missing).join(", ")}`);
    }
    if (extra.size) {
      errors.push(`[${locale}] Extra keys (not in pt-BR): ${setToSortedArray(extra).join(", ")}`);
    }
  }

  // Placeholder checks (must match across locales for each key)
  const baseKeyList = Object.keys(base).sort();
  for (const key of baseKeyList) {
    const basePlaceholders = extractPlaceholders(base[key]);

    for (const { locale } of LOCALE_FILES) {
      const v = maps[locale][key];
      if (typeof v !== "string") continue;
      const placeholders = extractPlaceholders(v);
      if (!setEq(basePlaceholders, placeholders)) {
        errors.push(
          `[${locale}] Placeholder mismatch at "${key}": expected {${setToSortedArray(basePlaceholders).join(
            ",",
          )}} got {${setToSortedArray(placeholders).join(",")}}`,
        );
      }
    }
  }

  if (errors.length) {
    console.error(`i18n check failed (${errors.length} issue(s)):\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `i18n check ok: ${baseKeyList.length} keys across ${LOCALE_FILES.length} locales (pt-BR/en/zh-CN)`,
  );
};

main().catch((e) => {
  console.error(e?.message || e);
  process.exitCode = 1;
});

