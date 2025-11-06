#!/usr/bin/env node
/*
 Sanity check for DJT Quest backend
 - Verifica variáveis de ambiente essenciais
 - Conecta no Supabase com Service Role
 - Verifica tabelas principais, views e bucket de avatars
*/

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadDotEnvIfPresent() {
  try {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
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
    }
  } catch {}
}

function print(status, msg) {
  const icon = status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : '❌';
  console.log(`${icon} ${msg}`);
}

async function main() {
  console.log('Running backend sanity check...');
  loadDotEnvIfPresent();

  const requiredEnv = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const optionalEnv = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_ANON_KEY',
  ];

  let failed = false;
  for (const k of requiredEnv) {
    if (!process.env[k]) {
      print('err', `Missing env: ${k}`);
      failed = true;
    } else {
      print('ok', `Env present: ${k}`);
    }
  }
  for (const k of optionalEnv) {
    if (process.env[k]) print('ok', `Env present: ${k}`); else print('warn', `Optional env missing: ${k}`);
  }

  if (failed) {
    console.log('\nProvide the missing envs above and re-run:');
    console.log('- For local: export SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    console.log('- For Vercel: set envs in Project Settings');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) Check profiles table
  try {
    const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
    if (error) throw error;
    print('ok', 'Table reachable: profiles');
  } catch (e) {
    print('err', `profiles check failed: ${e.message || e}`);
  }

  // 2) Check organizational tables
  for (const t of ['divisions', 'coordinations', 'teams']) {
    try {
      const { error } = await supabase.from(t).select('*', { head: true, count: 'exact' });
      if (error) throw error;
      print('ok', `Table reachable: ${t}`);
    } catch (e) {
      print('err', `${t} check failed: ${e.message || e}`);
    }
  }

  // 3) Views used by LeaderDashboard
  for (const v of ['team_xp_summary', 'team_challenge_performance', 'team_campaign_performance']) {
    try {
      const { error } = await supabase.from(v).select('*').limit(1);
      if (error) throw error;
      print('ok', `View reachable: ${v}`);
    } catch (e) {
      print('warn', `${v} view missing or empty: ${e.message || e}`);
    }
  }

  // 4) Storage bucket
  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    const hasAvatars = (data || []).some((b) => b.id === 'avatars');
    if (hasAvatars) print('ok', 'Storage bucket exists: avatars');
    else print('warn', 'Storage bucket missing: avatars (migration should create it)');
  } catch (e) {
    print('warn', `Storage check failed: ${e.message || e}`);
  }

  console.log('\nSanity check completed.');
}

main().catch((err) => {
  print('err', err?.message || String(err));
  process.exit(1);
});

