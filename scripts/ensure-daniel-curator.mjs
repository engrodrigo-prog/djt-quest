#!/usr/bin/env node
/*
 Idempotent seed: ensure an existing user has role content_curator.

 Premissas fixas:
 - NÃO cria usuário.
 - Apenas atribui role CONTENT_CURATOR ao usuário existente.
 - Registra auditoria (actor SYSTEM/MIGRATION) quando possível.

 Uso:
  node scripts/ensure-daniel-curator.mjs --email daniel@empresa.com
  DANIEL_BURINI_EMAIL=daniel@empresa.com node scripts/ensure-daniel-curator.mjs
*/

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadDotEnvIfPresent() {
  try {
    const envPath = path.resolve('.env');
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) return;
      const key = m[1];
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    });
  } catch {
    // ignore
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') {
      out.email = argv[i + 1];
      i++;
    }
  }
  return out;
}

const isDup = (err) => {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return code === '23505' || msg.includes('duplicate');
};

async function main() {
  loadDotEnvIfPresent();
  const args = parseArgs(process.argv);
  const email = String(args.email || process.env.DANIEL_BURINI_EMAIL || '').trim().toLowerCase();
  if (!email) {
    console.error('Missing --email or DANIEL_BURINI_EMAIL');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('id, email, name')
    .ilike('email', email)
    .maybeSingle();
  if (profErr) throw profErr;
  if (!profile?.id) {
    console.error(`User not found in profiles for email: ${email}`);
    process.exit(2);
  }

  const userId = profile.id;

  const { data: rolesBefore } = await admin.from('user_roles').select('role').eq('user_id', userId);

  const { error: insErr } = await admin.from('user_roles').insert({ user_id: userId, role: 'content_curator' });
  if (insErr && !isDup(insErr)) throw insErr;

  const { data: rolesAfter } = await admin.from('user_roles').select('role').eq('user_id', userId);

  // Best-effort audit
  try {
    await admin.from('audit_log').insert({
      actor_id: null,
      action: 'MIGRATION.assign_role.content_curator',
      entity_type: 'user_roles',
      entity_id: String(userId),
      before_json: { email, roles: (rolesBefore || []).map((r) => r.role) },
      after_json: { email, roles: (rolesAfter || []).map((r) => r.role) },
    });
  } catch {
    // ignore
  }

  console.log(`OK: ensured content_curator for ${email} (${userId})`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});

