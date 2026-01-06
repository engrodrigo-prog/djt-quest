import fs from "node:fs";
import path from "node:path";

const parseEnvLine = (line) => {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(String(line || ""));
  if (!match) return null;
  const key = match[1];
  let value = match[2] ?? "";
  if (!key) return null;

  // Strip surrounding quotes.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
};

const candidates = [
  ".env",
  ".vercel.env.local",
  path.join(".vercel", ".env.development.local"),
  path.join(".vercel", ".env.local"),
  path.join(".vercel", ".env.preview.local"),
];

export function loadLocalEnvIfNeeded() {
  try {
    if (globalThis.__djt_local_env_loaded) return;
    globalThis.__djt_local_env_loaded = true;

    for (const rel of candidates) {
      const filePath = path.join(process.cwd(), rel);
      if (!fs.existsSync(filePath)) continue;
      const text = fs.readFileSync(filePath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = String(line || "").trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parsed = parseEnvLine(trimmed);
        if (!parsed) continue;
        const prev = process.env[parsed.key];
        if (prev == null || prev === "") {
          process.env[parsed.key] = parsed.value;
        }
      }
    }
  } catch {
    // best-effort only
  }
}

