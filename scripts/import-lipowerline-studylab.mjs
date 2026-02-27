#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const IMPORT_SOURCE = 'greenvalley-lipowerline';
const DEFAULT_BASE_URL = 'https://www.greenvalleyintl.com/docs/lipowerline/';
const DEFAULT_CATEGORY = 'MANUAIS';
const DEFAULT_TOPIC = 'PROCEDIMENTOS';

const ALLOWED_TEXT_EXT = new Set(['', '.html', '.htm', '/']);
const BLOCKED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif', '.bmp', '.tiff', '.heic',
  '.pdf', '.zip', '.rar', '.7z', '.mp4', '.mp3', '.wav', '.mov', '.js', '.css', '.xml', '.json'
]);

function parseArgs(argv) {
  const args = { baseUrl: DEFAULT_BASE_URL, maxPages: 800, concurrency: 2, maxCharsPerPart: 11000, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--base-url' && next) {
      args.baseUrl = next;
      i += 1;
      continue;
    }
    if (key === '--max-pages' && next) {
      args.maxPages = Math.max(1, Number(next) || args.maxPages);
      i += 1;
      continue;
    }
    if (key === '--concurrency' && next) {
      args.concurrency = Math.max(1, Math.min(6, Number(next) || args.concurrency));
      i += 1;
      continue;
    }
    if (key === '--max-chars-per-part' && next) {
      args.maxCharsPerPart = Math.max(3000, Number(next) || args.maxCharsPerPart);
      i += 1;
      continue;
    }
    if (key === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let value = m[2] || '';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {}
}

function loadEnv() {
  const root = process.cwd();
  loadEnvFile(path.join(root, '.env'));
  loadEnvFile(path.join(root, '.env.local'));
  loadEnvFile(path.join(root, '.vercel.env.local'));
}

function decodeHtmlEntities(text) {
  const map = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&#x2F;': '/',
    '&apos;': "'"
  };
  let out = String(text || '');
  out = out.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&#x27;|&#x2F;|&apos;/g, (m) => map[m] || m);
  out = out.replace(/&#(\d+);/g, (_m, dec) => {
    const code = Number(dec);
    if (!Number.isFinite(code)) return _m;
    try {
      return String.fromCodePoint(code);
    } catch {
      return _m;
    }
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
    const code = Number.parseInt(hex, 16);
    if (!Number.isFinite(code)) return _m;
    try {
      return String.fromCodePoint(code);
    } catch {
      return _m;
    }
  });
  return out;
}

function extractTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) {
    const text = decodeHtmlEntities(h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (text) return text;
  }
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) {
    const text = decodeHtmlEntities(title[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (text) return text;
  }
  return 'Documento LiPowerline';
}

function htmlToText(html) {
  let content = String(html || '');
  const mainMatch = content.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[1]) content = mainMatch[1];

  content = content
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h1|h2|h3|h4|h5|h6|li|ul|ol|tr|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');

  content = decodeHtmlEntities(content);
  content = content
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  return content.trim();
}

function normalizeInternalUrl(rawHref, parentUrl, host, pathPrefix) {
  if (!rawHref) return null;
  const href = String(rawHref).trim();
  if (!href) return null;
  if (/^(javascript:|mailto:|tel:|#)/i.test(href)) return null;

  let url;
  try {
    url = new URL(href, parentUrl);
  } catch {
    return null;
  }

  if (url.hostname !== host) return null;
  if (!url.pathname.startsWith(pathPrefix)) return null;

  const lowerPath = url.pathname.toLowerCase();
  const extMatch = lowerPath.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0] : (lowerPath.endsWith('/') ? '/' : '');
  if (BLOCKED_EXT.has(ext)) return null;
  if (!ALLOWED_TEXT_EXT.has(ext) && ext !== '') return null;

  url.hash = '';
  url.search = '';
  return url.toString();
}

function extractLinks(html) {
  const links = [];
  const regex = /href\s*=\s*['"]([^'"]+)['"]/gi;
  let match;
  while ((match = regex.exec(html))) {
    if (match[1]) links.push(match[1]);
  }
  return links;
}

function summarize(text, maxLen = 280) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

function hashText(text) {
  return createHash('sha1').update(String(text || '')).digest('hex');
}

function splitLongText(text, maxChars) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];

  const overlap = Math.floor(Math.min(1200, maxChars * 0.1));
  const paragraphs = source.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const parts = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      let cursor = 0;
      while (cursor < para.length) {
        const end = Math.min(para.length, cursor + maxChars);
        const chunk = para.slice(cursor, end).trim();
        if (chunk) parts.push(chunk);
        if (end >= para.length) break;
        cursor = Math.max(0, end - overlap);
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      flush();
      current = para;
    }
  }
  flush();

  const dedup = [];
  const seen = new Set();
  for (const p of parts) {
    const key = hashText(p);
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(p);
  }
  return dedup;
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'DJT-Quest-StudyLab-Crawler/1.0',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function crawlSite(baseUrl, maxPages) {
  const base = new URL(baseUrl);
  const host = base.hostname;
  const pathPrefix = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const queue = [base.toString()];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];
  const contentHashes = new Set();

  while (queue.length && visited.size < maxPages) {
    const current = queue.shift();
    if (current) queued.delete(current);
    if (!current || visited.has(current)) continue;
    visited.add(current);

    let html = '';
    let status = 0;
    try {
      const resp = await fetchWithTimeout(current);
      status = resp.status;
      if (!resp.ok) {
        console.log(`[crawl] skip ${current} (http ${resp.status})`);
        continue;
      }
      const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html') && !current.toLowerCase().endsWith('.html')) {
        console.log(`[crawl] skip ${current} (content-type ${contentType || 'n/a'})`);
        continue;
      }
      html = await resp.text();
    } catch (err) {
      console.log(`[crawl] error ${current}: ${err?.message || err}`);
      continue;
    }

    const links = extractLinks(html);
    for (const href of links) {
      const normalized = normalizeInternalUrl(href, current, host, pathPrefix);
      if (!normalized) continue;
      if (!visited.has(normalized) && !queued.has(normalized)) {
        queue.push(normalized);
        queued.add(normalized);
      }
    }

    const title = extractTitle(html);
    const text = htmlToText(html);
    if (text.length < 180) {
      console.log(`[crawl] skip short ${current}`);
      continue;
    }

    const contentHash = hashText(text);
    if (contentHashes.has(contentHash)) {
      console.log(`[crawl] skip duplicate content ${current}`);
      continue;
    }
    contentHashes.add(contentHash);

    pages.push({
      url: current,
      title,
      text,
      status,
      textLength: text.length
    });
    console.log(`[crawl] ok ${pages.length} pages | queue=${queue.length} | ${current}`);
  }

  return pages;
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function pickOwnerUserId(supabase) {
  const leadershipRoles = ['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx', 'lider_equipe'];

  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('user_id, role')
    .in('role', leadershipRoles)
    .limit(30);

  const ownerFromRoles = (roleRows || []).map((r) => r?.user_id).find(Boolean);
  if (ownerFromRoles) return ownerFromRoles;

  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, studio_access')
    .eq('studio_access', true)
    .limit(10);

  const ownerFromProfiles = (profileRows || []).map((r) => r?.id).find(Boolean);
  if (ownerFromProfiles) return ownerFromProfiles;

  const { data: anyProfile } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);

  return anyProfile?.[0]?.id || null;
}

function toImportDocuments(pages, maxCharsPerPart) {
  const docs = [];
  const nowIso = new Date().toISOString();

  for (const page of pages) {
    const parts = splitLongText(page.text, maxCharsPerPart);
    if (!parts.length) continue;

    for (let idx = 0; idx < parts.length; idx += 1) {
      const partNumber = idx + 1;
      const totalParts = parts.length;
      const suffix = totalParts > 1 ? ` [Parte ${partNumber}/${totalParts}]` : '';
      const cleanTitle = String(page.title || 'Documento LiPowerline').replace(/\s+/g, ' ').trim();
      const title = `LiPowerline - ${cleanTitle}${suffix}`;

      const bodyText = parts[idx];
      const fullText = [
        `Fonte original: ${page.url}`,
        `Titulo original: ${cleanTitle}`,
        `Segmento: ${partNumber}/${totalParts}`,
        '',
        bodyText
      ].join('\n');

      const summary = summarize(bodyText, 320);
      const key = `${page.url}::${partNumber}`;

      docs.push({
        importKey: key,
        pageUrl: page.url,
        title,
        summary,
        fullText,
        partNumber,
        totalParts,
        metadata: {
          tags: ['lipowerline', 'greenvalley', 'manual', 'catalogo-tecnico'],
          import: {
            source: IMPORT_SOURCE,
            page_url: page.url,
            page_title: cleanTitle,
            part: partNumber,
            total_parts: totalParts,
            crawled_at: nowIso
          },
          ai: {
            topic: DEFAULT_TOPIC,
            category: DEFAULT_CATEGORY,
            tags: ['lipowerline', 'greenvalley', 'manual', 'catalogo-tecnico']
          }
        }
      });
    }
  }

  return docs;
}

async function listExistingImportRows(supabase, baseUrl) {
  const base = new URL(baseUrl);
  const likePattern = `${base.origin}${base.pathname}%`;
  const rows = [];
  let offset = 0;
  const pageSize = 400;

  while (true) {
    const { data, error } = await supabase
      .from('study_sources')
      .select('id, url, metadata, title')
      .ilike('url', likePattern)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }

  return rows;
}

function buildExistingMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : null;
    const src = String(meta?.import?.source || '').trim();
    if (src && src !== IMPORT_SOURCE) continue;
    const url = String(row?.url || '').trim();
    if (!url) continue;
    const part = Number(meta?.import?.part || 1) || 1;
    const key = `${url}::${part}`;
    map.set(key, row);
  }
  return map;
}

async function upsertDocuments({ supabase, docs, ownerUserId, dryRun }) {
  const existingRows = await listExistingImportRows(supabase, DEFAULT_BASE_URL);
  const existingMap = buildExistingMap(existingRows);

  const created = [];
  const updated = [];

  for (const doc of docs) {
    const payload = {
      user_id: ownerUserId,
      title: doc.title,
      kind: 'url',
      url: doc.pageUrl,
      summary: doc.summary,
      full_text: doc.fullText,
      topic: DEFAULT_TOPIC,
      category: DEFAULT_CATEGORY,
      scope: 'org',
      published: true,
      is_persistent: true,
      expires_at: null,
      ingest_status: 'pending',
      ingest_error: null,
      metadata: doc.metadata
    };

    const existing = existingMap.get(doc.importKey);
    if (existing) {
      if (!dryRun) {
        const { error } = await supabase.from('study_sources').update(payload).eq('id', existing.id);
        if (error) throw error;
      }
      updated.push(existing.id);
    } else {
      if (!dryRun) {
        const { data, error } = await supabase.from('study_sources').insert(payload).select('id').single();
        if (error) throw error;
        created.push(data.id);
      }
    }
  }

  return { created, updated, existingCount: existingRows.length };
}

async function ingestSources({ sourceIds, concurrency }) {
  const { default: aiStudyChat } = await import('../server/api-handlers/ai-study-chat.js');

  let index = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  const results = [];

  async function worker() {
    while (index < sourceIds.length) {
      const current = sourceIds[index];
      index += 1;

      const req = {
        method: 'POST',
        headers: {},
        query: {},
        body: {
          mode: 'ingest',
          source_id: current,
          recatalog: false
        }
      };
      const res = createMockRes();

      try {
        await aiStudyChat(req, res);
        const body = res.body || {};
        const isOk = Boolean(body?.success) && Boolean(body?.ingested);
        if (isOk) {
          ok += 1;
        } else {
          skipped += 1;
        }
        results.push({ id: current, ok: isOk, body });
        console.log(`[ingest] ${current} -> ${isOk ? 'ok' : 'skip'} (${ok + skipped + failed}/${sourceIds.length})`);
      } catch (err) {
        failed += 1;
        results.push({ id: current, ok: false, error: err?.message || String(err) });
        console.log(`[ingest] ${current} -> failed (${ok + skipped + failed}/${sourceIds.length})`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { ok, skipped, failed, results };
}

async function validateImport(supabase, sourceIds) {
  if (!sourceIds.length) return { total: 0, ok: 0, failed: 0, pending: 0, chunksTotal: 0, withoutChunks: 0 };

  const { data: statuses, error: statusErr } = await supabase
    .from('study_sources')
    .select('id, ingest_status')
    .in('id', sourceIds);
  if (statusErr) throw statusErr;

  const { data: chunkRows, error: chunkErr } = await supabase
    .from('study_source_chunks')
    .select('source_id')
    .in('source_id', sourceIds)
    .limit(200000);
  if (chunkErr) throw chunkErr;

  const chunkCountBySource = new Map();
  for (const row of chunkRows || []) {
    const id = row?.source_id;
    if (!id) continue;
    chunkCountBySource.set(id, (chunkCountBySource.get(id) || 0) + 1);
  }

  const tally = { total: sourceIds.length, ok: 0, failed: 0, pending: 0, chunksTotal: 0, withoutChunks: 0 };
  for (const row of statuses || []) {
    const status = String(row?.ingest_status || 'pending').toLowerCase();
    if (status === 'ok') tally.ok += 1;
    else if (status === 'failed') tally.failed += 1;
    else tally.pending += 1;

    const chunks = chunkCountBySource.get(row.id) || 0;
    tally.chunksTotal += chunks;
    if (chunks === 0) tally.withoutChunks += 1;
  }

  return tally;
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  process.env.DJT_ALLOW_DEV_INGEST = process.env.DJT_ALLOW_DEV_INGEST || '1';

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log(`[start] crawling ${args.baseUrl}`);
  const pages = await crawlSite(args.baseUrl, args.maxPages);
  console.log(`[crawl] collected pages=${pages.length}`);
  if (!pages.length) {
    console.log('[done] no pages collected');
    return;
  }

  const docs = toImportDocuments(pages, args.maxCharsPerPart);
  console.log(`[prep] documents=${docs.length}`);
  if (!docs.length) {
    console.log('[done] no documents generated');
    return;
  }

  const ownerUserId = await pickOwnerUserId(supabase);
  if (!ownerUserId) {
    throw new Error('Could not resolve owner user id for study_sources');
  }
  console.log(`[owner] user_id=${ownerUserId}`);

  const upsertResult = await upsertDocuments({
    supabase,
    docs,
    ownerUserId,
    dryRun: args.dryRun
  });

  console.log(
    `[upsert] created=${upsertResult.created.length} updated=${upsertResult.updated.length} existing_scanned=${upsertResult.existingCount}`
  );

  if (args.dryRun) {
    console.log('[dry-run] skipping ingest');
    return;
  }

  const idsToIngest = [...upsertResult.created, ...upsertResult.updated];
  const ingest = await ingestSources({ sourceIds: idsToIngest, concurrency: args.concurrency });
  console.log(`[ingest] ok=${ingest.ok} skipped=${ingest.skipped} failed=${ingest.failed}`);

  const validation = await validateImport(supabase, idsToIngest);
  console.log(
    `[validate] total=${validation.total} ok=${validation.ok} failed=${validation.failed} pending=${validation.pending} chunks=${validation.chunksTotal} without_chunks=${validation.withoutChunks}`
  );

  if (validation.failed > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
