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

export async function extractPdfText(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return String(data?.text || '').trim();
}

export function extractPlainText(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : String(buffer || '');
  return String(text || '').trim();
}
