#!/usr/bin/env node
/*
 Download all files from Supabase Storage bucket 'avatars' into src/assets/avatars
 Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'assets', 'avatars');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAll(prefix = '') {
  let page = 0;
  const perPage = 1000;
  let all = [];
  while (true) {
    const { data, error } = await supabase.storage.from('avatars').list(prefix, {
      limit: perPage,
      offset: page * perPage,
    });
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data.map((d) => ({ ...d, prefix })));
    page += 1;
  }
  return all;
}

async function downloadAll() {
  // List top-level prefixes (userId folders)
  const roots = await listAll('');
  const folders = roots.filter((e) => e.id === null && e.name);
  const files = roots.filter((e) => e.id !== null);

  // Include nested files
  for (const folder of folders) {
    const inner = await listAll(folder.name);
    inner.forEach((f) => files.push({ ...f, prefix: folder.name }));
  }

  let ok = 0, fail = 0;
  for (const f of files) {
    const key = f.prefix ? `${f.prefix}/${f.name}` : f.name;
    if (!key) continue;
    const { data, error } = await supabase.storage.from('avatars').download(key);
    if (error) { console.warn('Skip', key, error.message); fail++; continue; }
    const buf = Buffer.from(await data.arrayBuffer());
    const safeKey = key.replace(/[\\/:]/g, '_');
    const out = path.join(outDir, safeKey);
    fs.writeFileSync(out, buf);
    ok++;
  }
  console.log(`Downloaded ${ok} files to ${outDir}. Failed: ${fail}`);
}

downloadAll().catch((e) => { console.error(e); process.exit(1); });

