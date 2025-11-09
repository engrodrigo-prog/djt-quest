import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { deriveOrgUnits, buildOrgUpserts } from './utils/org-helpers.mjs';

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectUrl = process.env.SUPABASE_URL || 'https://eyuehdefoedxcunxiyvb.supabase.co';

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

const users = lines.slice(1).map((line) => {
  const parts = parseCsvLine(line);
  const [nome, matricula, email, cargo, sigla_area, base_operacional, date_of_birth] = parts;
  const org = deriveOrgUnits(sigla_area || base_operacional);
  return {
    nome,
    matricula,
    email,
    cargo,
    sigla_area: sigla_area?.trim() || org?.teamId || null,
    base_operacional: base_operacional?.trim() || org?.teamId || null,
    date_of_birth,
    org,
  };
});

const resetPassword = '123456';

const cargoToRole = (cargo = '') => {
  const normalized = cargo.trim().toLowerCase();
  if (normalized.startsWith('gerente ii')) return 'gerente_djt';
  if (normalized.startsWith('gerente i')) return 'gerente_divisao_djtx';
  if (normalized.startsWith('coordenação') || normalized.startsWith('coordenadores')) return 'coordenador_djtx';
  return 'colaborador';
};

const orgUpserts = buildOrgUpserts(users.map((u) => u.org).filter(Boolean));

const syncOrgTables = async () => {
  const upsertTable = async (table, payload) => {
    if (!payload.length) return;
    const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn(`Falha ao sincronizar ${table}:`, error.message);
    }
  };

  await upsertTable('divisions', orgUpserts.divisions);
  await upsertTable('coordinations', orgUpserts.coordinations);
  await upsertTable('teams', orgUpserts.teams);
};

await syncOrgTables();

for (const userData of users) {
  const email = userData.email?.trim();
  const nome = userData.nome?.trim();
  if (!email || !nome) continue;
  const role = cargoToRole(userData.cargo);
  const isLeaderRole = ['coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt'].includes(role);
  const org = userData.org;

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  let userId = existingProfile?.id;
  if (userId) {
    const { error: authErr } = await supabase.auth.admin.updateUserById(userId, {
      email,
      password: resetPassword,
      email_confirm: true,
      user_metadata: { name: nome },
    });
    if (authErr) console.warn('auth update warn', email, authErr.message);
  } else {
    const { data: authUser, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password: resetPassword,
      email_confirm: true,
      user_metadata: { name: nome },
    });
    if (createErr || !authUser.user) {
      console.error('auth create err', email, createErr?.message);
      continue;
    }
    userId = authUser.user.id;
  }

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({
      name: nome,
      email,
      matricula: userData.matricula,
      operational_base: userData.base_operacional,
      sigla_area: userData.sigla_area,
      must_change_password: false,
      needs_profile_completion: false,
      is_leader: isLeaderRole,
      studio_access: isLeaderRole,
      date_of_birth: userData.date_of_birth || null,
      division_id: org?.divisionId || null,
      coord_id: org?.coordinationId || null,
      team_id: org?.teamId || null,
    })
    .eq('id', userId);
  if (profileErr) {
    console.error('profile update err', email, profileErr.message);
    continue;
  }

  const { error: roleErr } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role }, { onConflict: 'user_id,role' });
  if (roleErr) {
    console.error('role upsert err', email, roleErr.message);
  }
}

console.log('Import manual concluído.');
