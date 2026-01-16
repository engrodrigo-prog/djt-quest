// @ts-nocheck
import { extractPdfText, extractPlainText } from "../lib/import-parsers.js";
import { extractImageTextWithAi, parseJsonFromAiContent } from "../lib/ai-curation-provider.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL_FINANCE_TABLE = process.env.OPENAI_MODEL_FINANCE_TABLE || "gpt-4.1-mini";

const inferExt = (name) => {
  const clean = String(name || "").split("?")[0].split("#")[0];
  const i = clean.lastIndexOf(".");
  if (i === -1) return "";
  return clean.slice(i + 1).toLowerCase();
};

export const parseStorageRefFromUrl = (supabaseUrl, raw) => {
  try {
    const base = String(supabaseUrl || "").replace(/\/+$/, "");
    if (!base) return null;
    const url = new URL(String(raw || ""));
    const path = url.pathname;
    // public object
    let m = path.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
    // signed object
    m = path.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
    // fall back for fully-qualified public URL prefix
    const prefix = `${base}/storage/v1/object/public/`;
    const href = String(url.href || "");
    if (href.startsWith(prefix)) {
      const rest = href.slice(prefix.length);
      const idx = rest.indexOf("/");
      if (idx > 0) {
        return { bucket: rest.slice(0, idx), path: decodeURIComponent(rest.slice(idx + 1)) };
      }
    }
    return null;
  } catch {
    return null;
  }
};

const normalizeCsv = (raw) => {
  const s = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!s) return null;
  if (s.length > 80_000) return s.slice(0, 79_000) + "\n...";
  return s;
};

const buildCsvPath = (storagePath) => {
  const base = String(storagePath || "").replace(/\r/g, "").trim();
  if (!base) return null;
  const withoutExt = base.replace(/\.[^.\/\\]+$/, "");
  return `${withoutExt}.table.csv`;
};

const jsonToCsv = (rows, delimiter = ";") => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const keys = Array.from(
    new Set(
      list
        .flatMap((r) => (r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r) : []))
        .filter(Boolean),
    ),
  );
  if (!keys.length) return null;
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (s.includes('"') || s.includes("\n") || s.includes(delimiter)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [keys.map(esc).join(delimiter)];
  for (const r of list) {
    const row = r && typeof r === "object" && !Array.isArray(r) ? r : {};
    lines.push(keys.map((k) => esc(row?.[k])).join(delimiter));
  }
  return normalizeCsv(lines.join("\n"));
};

const extractTableFromTextWithAi = async (rawText) => {
  const text = String(rawText || "").trim();
  if (!text || text.length < 40) return null;
  if (!OPENAI_API_KEY) return null;

  const prompt =
    "Você recebe o TEXTO extraído de um comprovante/nota/recibo/planilha (OCR ou PDF).\n" +
    "Objetivo: extrair QUALQUER tabela presente para CSV.\n\n" +
    "Regras:\n" +
    "- Responda APENAS com JSON válido.\n" +
    "- Se NÃO houver tabela (linhas/colunas), retorne {\"has_table\":false,\"rows\":[]}.\n" +
    "- Se houver tabela, retorne {\"has_table\":true,\"rows\":[{...}]}, onde cada objeto é uma linha.\n" +
    "- Use chaves curtas e consistentes (ex.: data, descricao, qtd, valor, total).\n" +
    "- NÃO invente valores.\n\n" +
    "TEXTO:\n" +
    text.slice(0, 22_000);

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL_FINANCE_TABLE,
      messages: [
        { role: "system", content: "Você extrai tabelas e retorna JSON estrito." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 900,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonFromAiContent(content).parsed;
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.has_table) return null;
  const csv = jsonToCsv(parsed.rows, ";");
  return csv;
};

export const extractCsvForFinanceAttachment = async (params) => {
  const buffer = params?.buffer;
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const filename = String(params?.filename || "").trim();
  const contentType = String(params?.contentType || "").trim().toLowerCase();
  const ext = inferExt(filename);

  let extractedText = "";
  if (contentType.includes("pdf") || ext === "pdf") {
    extractedText = await extractPdfText(buffer);
  } else if (contentType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif", "heic", "heif"].includes(ext)) {
    const ocr = await extractImageTextWithAi({
      buffer,
      mime: contentType || `image/${ext || "jpeg"}`,
      hint: "Comprovante/nota fiscal/recibo ou planilha. Extraia texto com foco em itens e valores.",
      openaiKey: OPENAI_API_KEY,
    });
    if (!ocr.ok) return null;
    extractedText = [ocr.description, ocr.text].filter(Boolean).join("\n\n").trim();
  } else {
    extractedText = extractPlainText(buffer);
  }

  if (!extractedText || extractedText.trim().length < 40) return null;
  const csv = await extractTableFromTextWithAi(extractedText);
  return normalizeCsv(csv || "");
};

export const buildFinanceCsvPath = buildCsvPath;
