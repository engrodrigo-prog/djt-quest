#!/usr/bin/env node
/**
 * Sanitize teams/coordinations/divisions based on CSV (src/assets/cadastro_cpfl_go_import.csv)
 * - Ensures only valid base operational siglas exist as teams (TEXT ids)
 * - Upserts divisions (first segment), coordinations (DIV-SEG), and teams (full sigla)
 * - Optionally prunes teams not present in CSV (if not referenced)
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sanitize-teams-from-csv.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertDjtQuestSupabaseUrl } from '../server/env-guard.js';

const projectUrl = process.env.SUPABASE_URL || 'https://eyuehdefoedxcunxiyvb.supabase.co';
assertDjtQuestSupabaseUrl(projectUrl, { allowLocal: true, envName: 'SUPABASE_URL' });
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(projectUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const CSV_PATH = path.resolve(process.cwd(), 'src/assets/cadastro_cpfl_go_import.csv');

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) continue;
    const row = {};
    header.forEach((h, idx) => (row[h] = (cols[idx] || '').trim()));
    rows.push(row);
  }
  return rows;
}

function normalizeSigla(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function deriveOrg(sigla) {
  const norm = normalizeSigla(sigla);
  if (!norm) return null;
  const parts = norm.split('-').filter(Boolean);
  const divisionId = parts[0] || 'DJT';
  const coordPart = parts[1] || 'SEDE';
  const coordId = `${divisionId}-${coordPart}`;
  const teamId = norm;
  return { divisionId, coordId, teamId };
}

async function main() {
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csv);
  const siglas = new Set();
  for (const r of rows) {
    if (r.base_operacional) siglas.add(normalizeSigla(r.base_operacional));
    else if (r.sigla_area) siglas.add(normalizeSigla(r.sigla_area));
  }
  if (!siglas.size) {
    console.log('No siglas found in CSV. Nothing to do.');
    return;
  }

  // Build required org sets
  const divisions = new Set();
  const coords = new Set();
  const teams = new Set(siglas);
  for (const t of teams) {
    const org = deriveOrg(t);
    if (!org) continue;
    divisions.add(org.divisionId);
    coords.add(org.coordId);
  }

  // Upsert divisions
  for (const id of divisions) {
    const { error } = await supabase.from('divisions').upsert({ id, name: id }, { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`Upserted divisions: ${divisions.size}`);

  // Upsert coordinations
  for (const id of coords) {
    const division_id = id.split('-')[0];
    const name = id;
    const { error } = await supabase.from('coordinations').upsert({ id, division_id, name }, { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`Upserted coordinations: ${coords.size}`);

  // Upsert teams
  for (const id of teams) {
    const org = deriveOrg(id);
    if (!org) continue;
    const name = id;
    const { error } = await supabase.from('teams').upsert({ id, coord_id: org.coordId, name }, { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`Upserted teams: ${teams.size}`);

  // Optionally prune teams not present in CSV if safe (no active references)
  const { data: existingTeams } = await supabase.from('teams').select('id');
  const existingIds = new Set((existingTeams || []).map((t) => t.id));
  const toRemove = [...existingIds].filter((id) => !teams.has(id));

  let removed = 0;
  for (const id of toRemove) {
    // Remove only if not referenced by profiles or events
    const { count: profCount } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('team_id', id);
    const { count: evCount } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .in(
        'user_id',
        (await supabase.from('profiles').select('id').eq('team_id', id)).data?.map((p) => p.id) || ['00000000-0000-0000-0000-000000000000']
      );
    if ((profCount || 0) === 0 && (evCount || 0) === 0) {
      const { error } = await supabase.from('teams').delete().eq('id', id);
      if (error) throw error;
      removed++;
    }
  }
  console.log(`Removed stale teams (safe): ${removed}`);

  console.log('✅ Team sanitization completed.');
}

main().catch((err) => {
  console.error('Sanitization error:', err?.message || err);
  process.exit(1);
});
