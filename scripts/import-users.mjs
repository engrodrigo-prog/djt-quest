import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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

const rows = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(Boolean);
const users = rows.slice(1).map(line => {
  const parts = line.split(',');
  const [nome, matricula, email, cargo, sigla_area, base_operacional, date_of_birth] = parts;
  return { nome, matricula, email, cargo, sigla_area, base_operacional, date_of_birth };
});

const resetPassword = '123456';

const cargoToRole = (cargo = '') => {
  const normalized = cargo.trim().toLowerCase();
  if (normalized.startsWith('gerente ii')) return 'gerente_djt';
  if (normalized.startsWith('gerente i')) return 'gerente_divisao_djtx';
  if (normalized.startsWith('coordenação') || normalized.startsWith('coordenadores')) return 'coordenador_djtx';
  return 'colaborador';
};

for (const userData of users) {
  const email = userData.email?.trim();
  const nome = userData.nome?.trim();
  if (!email || !nome) continue;
  const role = cargoToRole(userData.cargo);
  const isLeaderRole = ['coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt'].includes(role);

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
      must_change_password: true,
      needs_profile_completion: false,
      is_leader: isLeaderRole,
      studio_access: isLeaderRole,
      date_of_birth: userData.date_of_birth || null,
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
