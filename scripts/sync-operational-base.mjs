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

const chunk = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

const normalizeSigla = (value) => {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase();
  return cleaned || null;
};

const main = async () => {
  console.log('🔄 Carregando perfis...');
  const { data, error } = await supabase
    .from('profiles')
    .select('id, sigla_area, operational_base');
  if (error) throw error;

  const needsUpdate = (data || []).reduce((acc, profile) => {
    const preferredSigla = normalizeSigla(profile.sigla_area) || normalizeSigla(profile.operational_base);
    if (!preferredSigla) return acc;
    const currentBase = normalizeSigla(profile.operational_base);
    const currentSigla = normalizeSigla(profile.sigla_area);
    if (currentBase === preferredSigla && currentSigla === preferredSigla) return acc;
    acc.push({ id: profile.id, sigla_area: preferredSigla, operational_base: preferredSigla });
    return acc;
  }, []);

  if (!needsUpdate.length) {
    console.log('✅ Nenhum ajuste necessário.');
    return;
  }

  console.log(`Atualizando ${needsUpdate.length} perfis para alinhar base operacional...`);
  const batches = chunk(needsUpdate, 100);
  for (const batch of batches) {
    const { error: updateErr } = await supabase
      .from('profiles')
      .upsert(batch, { onConflict: 'id' });
    if (updateErr) throw updateErr;
  }

  console.log('✅ Sincronização concluída.');
};

main().catch((err) => {
  console.error('Erro ao sincronizar base operacional:', err.message);
  process.exit(1);
});

