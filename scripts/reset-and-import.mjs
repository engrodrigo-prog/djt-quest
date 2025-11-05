import { spawn } from 'child_process';

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eyuehdefoedxcunxiyvb.supabase.co';
const KEEP_EMAIL = (process.env.KEEP_EMAIL || 'RODRIGONASC@CPFL.COM.BR');

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY antes de executar.');
  process.exit(1);
}

const run = (cmd, args = [], envExtra = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...envExtra },
  });
  child.on('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${cmd} ${args.join(' ')} saiu com código ${code}`));
  });
});

const main = async () => {
  console.log('1) Convertendo CSV original...');
  await run('node', ['scripts/convert-import-csv.mjs']);

  console.log('2) Hidratando perfis a partir do Auth...');
  await run('node', ['scripts/hydrate-profiles-from-auth.mjs'], {
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
  });

  console.log('3) Limpando todos os usuários exceto', KEEP_EMAIL);
  await run('node', ['scripts/delete-except-one.mjs'], {
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
    KEEP_EMAIL,
  });

  console.log('4) Hidratando novamente para garantir consistência...');
  await run('node', ['scripts/hydrate-profiles-from-auth.mjs'], {
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
  });

  console.log('5) Importando usuários do CSV convertido...');
  await run('node', ['scripts/import-users.mjs'], {
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
  });

  console.log('✔ Processo concluído. Usuários recriados a partir do CSV.');
};

main().catch((err) => {
  console.error('Erro durante reset/import:', err.message);
  process.exit(1);
});
