import { createClient } from '@supabase/supabase-js';
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

const main = async () => {
console.log('Listando usuários Auth (paginado)...');
let page = 1;
const perPage = 1000;
let hydrated = 0;
while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
  if (error) throw error;
  const users = data?.users || [];
  if (users.length === 0) break;
  for (const user of users) {
    if (!user.email) continue;
    const { error: upsertError } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email.toLowerCase(),
        name: user.user_metadata?.name || user.email,
        must_change_password: false,
        needs_profile_completion: false,
      }, { onConflict: 'id' });
    if (upsertError) {
      console.error('Falha ao upsert profile', user.email, upsertError.message);
    } else {
      hydrated++;
    }
  }
  page++;
}

console.log(`Perfis sincronizados: ${hydrated}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
