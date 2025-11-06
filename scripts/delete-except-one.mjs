import { createClient } from '@supabase/supabase-js';

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectUrl = process.env.SUPABASE_URL || 'https://eyuehdefoedxcunxiyvb.supabase.co';
const keepEmail = (process.env.KEEP_EMAIL || 'RODRIGONASC@CPFL.COM.BR').toLowerCase();

if (!serviceRoleKey) {
  throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(projectUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deleteAllProfilesExceptKeep() {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email');
  if (error) throw error;
  const targets = (profiles || []).filter((p) => (p.email || '').toLowerCase() !== keepEmail);
  if (!targets.length) return 0;

  const ids = targets.map((p) => p.id);
  const emails = targets.map((p) => p.email);
  console.log(`Removendo ${ids.length} usuários em profiles (mantendo ${keepEmail}).`);

  const { error: roleErr } = await supabase
    .from('user_roles')
    .delete()
    .in('user_id', ids);
  if (roleErr) throw roleErr;

  const { error: profileErr } = await supabase
    .from('profiles')
    .delete()
    .in('id', ids);
  if (profileErr) throw profileErr;

  for (const { id, email } of targets) {
    const { error: authErr } = await supabase.auth.admin.deleteUser(id);
    if (authErr) {
      console.warn('Falha ao excluir do Auth', email, authErr.message);
    }
    // Evita rate limit agressivo
    await sleep(25);
  }

  console.log(`Exclusão concluída em profiles. Emails removidos:`, emails);
  return targets.length;
}

async function deleteAllAuthExceptKeepPaginated() {
  console.log('Nenhum profile encontrado. Operando direto no Auth (paginado)...');
  let totalDeleted = 0;
  let pass = 0;
  while (true) {
    pass++;
    let page = 1;
    const perPage = 1000;
    let deletedThisPass = 0;
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const users = data?.users || [];
      if (users.length === 0) break;
      for (const user of users) {
        const email = (user.email || '').toLowerCase();
        if (!email || email === keepEmail) continue;
        const { error: delErr } = await supabase.auth.admin.deleteUser(user.id);
        if (delErr) {
          console.warn('Falha ao excluir do Auth', user.email, delErr.message);
        } else {
          deletedThisPass++;
          totalDeleted++;
        }
        await sleep(10);
      }
      page++;
    }
    console.log(`Passo ${pass}: removidos ${deletedThisPass} usuários no Auth.`);
    if (deletedThisPass === 0) break; // estável
  }
  if (totalDeleted === 0) {
    console.log('Nenhum usuário para excluir.');
  } else {
    console.log(`Exclusão Auth concluída. Total removido: ${totalDeleted}`);
  }
  return totalDeleted;
}

const main = async () => {
  // Primeiro, tente via profiles; se estiver vazio, caia no Auth (paginado)
  const removedInProfiles = await deleteAllProfilesExceptKeep();
  if (removedInProfiles === 0) {
    await deleteAllAuthExceptKeepPaginated();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
