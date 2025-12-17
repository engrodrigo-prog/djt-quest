import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const normalizeHeader = (h) =>
  String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const parseCsv = (text) => {
  const s = String(text || '');
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cur);
      cur = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
      continue;
    }
    if (ch === '\r') continue;
    cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
};

const toQuestions = (rows) => {
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const get = (r, key) => {
    const i = idx[key];
    if (i == null) return '';
    return String(r[i] ?? '').trim();
  };

  const out = [];
  for (const r of rows.slice(1)) {
    const pergunta = get(r, 'pergunta');
    if (!pergunta) continue;
    const item = {
      pergunta,
      alt_a: get(r, 'alt_a'),
      alt_b: get(r, 'alt_b'),
      alt_c: get(r, 'alt_c'),
      alt_d: get(r, 'alt_d'),
      alt_e: get(r, 'alt_e'),
      correta: get(r, 'correta').toUpperCase(),
      explicacao: get(r, 'explicacao'),
    };
    out.push(item);
  }
  return out;
};

export function parseCsvQuestions(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : String(buffer || '');
  const rows = parseCsv(text);
  return { headers: rows[0] || [], questions: toQuestions(rows) };
}

export function parseXlsxQuestions(buffer) {
  const xlsx = require('xlsx');
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) return { sheet: null, questions: [] };
  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return { sheet: sheetName, questions: toQuestions(rows) };
}

export function parseJsonQuestions(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : String(buffer || '');
  const trimmed = String(text || '').trim();
  if (!trimmed) return { questions: [] };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { questions: [] };
  }

  const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [];
  const questions = [];
  for (const q of rawList) {
    if (!q || typeof q !== 'object') continue;
    const pergunta = String(q.pergunta || q.question || q.prompt || '').trim();
    if (!pergunta) continue;
    const corretaRaw = String(q.correta || q.correct || q.answer || '').trim().toUpperCase();
    const correta = ['A', 'B', 'C', 'D', 'E'].includes(corretaRaw) ? corretaRaw : '';
    questions.push({
      pergunta,
      alt_a: String(q.alt_a || q.a || q.option_a || q.optionA || '').trim(),
      alt_b: String(q.alt_b || q.b || q.option_b || q.optionB || '').trim(),
      alt_c: String(q.alt_c || q.c || q.option_c || q.optionC || '').trim(),
      alt_d: String(q.alt_d || q.d || q.option_d || q.optionD || '').trim(),
      alt_e: String(q.alt_e || q.e || q.option_e || q.optionE || '').trim(),
      correta,
      explicacao: String(q.explicacao || q.explanation || '').trim(),
    });
  }
  return { questions };
}

export async function extractPdfText(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return String(data?.text || '').trim();
}

export async function extractDocxText(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return String(result?.value || '').trim();
}

export function extractJsonText(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : String(buffer || '');
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2).trim();
  } catch {
    // Se não for JSON válido, devolve como texto mesmo (best-effort)
    return trimmed;
  }
}

export function extractPlainText(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : String(buffer || '');
  return String(text || '').trim();
}
