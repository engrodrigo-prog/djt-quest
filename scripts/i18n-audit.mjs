import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

const isTextFile = (p) => p.endsWith(".ts") || p.endsWith(".tsx");

const walk = async (dir) => {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile() && isTextFile(full)) out.push(full);
  }
  return out;
};

const looksPortuguese = (s) =>
  /[áéíóúãõçÁÉÍÓÚÃÕÇ]/.test(s) ||
  /\b(Não|Senha|Solicitar|Carregando|Voltar|Equipe|Usuário|Aprovad|Rejeitad|Pendente)\b/.test(s);

const shouldIgnoreLine = (line) => {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith("import ")) return true;
  if (t.startsWith("//")) return true;
  if (t.includes("t(\"") || t.includes("t('") || t.includes("tr(\"") || t.includes("tr('")) return true;
  return false;
};

const main = async () => {
  const files = await walk(SRC);
  const hits = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (shouldIgnoreLine(line)) continue;
      if (!looksPortuguese(line)) continue;
      hits.push({ file: path.relative(ROOT, file), line: i + 1, text: line.trim() });
    }
  }

  if (!hits.length) {
    console.log("i18n audit: no obvious hardcoded Portuguese strings found.");
    return;
  }

  console.log(`i18n audit: ${hits.length} potential hardcoded string line(s)\n`);
  for (const h of hits.slice(0, 250)) {
    console.log(`${h.file}:${h.line}  ${h.text}`);
  }
  if (hits.length > 250) {
    console.log(`\n… truncated (${hits.length - 250} more)`);
  }

  process.exitCode = 1;
};

main().catch((e) => {
  console.error(e?.message || e);
  process.exitCode = 1;
});

