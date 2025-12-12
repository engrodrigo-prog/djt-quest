import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { deriveOrgUnits, buildOrgUpserts } from './utils/org-helpers.mjs';
import { assertDjtQuestSupabaseUrl } from '../server/env-guard.js';

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectUrl = process.env.SUPABASE_URL || 'https://eyuehdefoedxcunxiyvb.supabase.co';

assertDjtQuestSupabaseUrl(projectUrl, { allowLocal: true, envName: 'SUPABASE_URL' });

if (!serviceRoleKey) {
  throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(projectUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const csvPath = path.resolve('src', 'assets', 'cadastro_cpfl_go_import.csv');
if (!fs.existsSync(csvPath)) {
  throw new Error(`CSV não encontrado em ${csvPath}`);
}

const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(Boolean);

const parseCsvLine = (line) => {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((s) => s.trim());
};

const header = parseCsvLine(lines[0]);
const colIndex = {
  nome: header.indexOf('nome'),
  email: header.indexOf('email'),
  sigla_area: header.indexOf('sigla_area'),
};

if (colIndex.email === -1 || colIndex.sigla_area === -1) {
  throw new Error('CSV precisa das colunas email e sigla_area');
}

const users = lines.slice(1).map((line) => {
  const cols = parseCsvLine(line);
  return {
    email: (cols[colIndex.email] || '').toLowerCase(),
    sigla: cols[colIndex.sigla_area] || '',
    name: cols[colIndex.nome] || '',
  };
});

const orgEntries = users.map((u) => deriveOrgUnits(u.sigla));
const { divisions, coordinations, teams } = buildOrgUpserts(orgEntries);

const upsertTable = async (table, payload, conflict) => {
  if (!payload.length) return;
  const { error } = await supabase.from(table).upsert(payload, { onConflict: conflict });
  if (error) throw error;
  console.log(`→ ${table}: ${payload.length} registros sincronizados.`);
};

const chunk = (arr, size = 50) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const main = async () => {
  console.log('🔁 Sincronizando estrutura organizacional (divisões/coordenações/equipes)...');
  await upsertTable('divisions', divisions, 'id');
  await upsertTable('coordinations', coordinations, 'id');
  await upsertTable('teams', teams, 'id');

  console.log('🔁 Atualizando perfis com divisão/coordenação/equipe...');
  const updates = users.map((user, index) => ({ user, org: orgEntries[index] })).filter((item) => item.user.email && item.org);
  let updated = 0;
  for (const batch of chunk(updates, 25)) {
    const promises = batch.map(async ({ user, org }) => {
      const { error } = await supabase
        .from('profiles')
        .update({
          division_id: org.divisionId,
          coord_id: org.coordinationId,
          team_id: org.teamId,
        })
        .eq('email', user.email);
      if (error) {
        console.warn('Falha ao atualizar perfil', user.email, error.message);
      } else {
        updated += 1;
      }
    });
    await Promise.all(promises);
  }

  console.log(`✅ Perfis atualizados: ${updated}`);
};

main().catch((err) => {
  console.error('Erro ao sincronizar estrutura organizacional:', err?.message || err);
  process.exit(1);
});
