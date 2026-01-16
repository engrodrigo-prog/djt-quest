#!/usr/bin/env node
/*
 Seed: Finance Requests (reembolso/adiantamento)

 Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-finance-requests.mjs --email user@cpfl.com.br
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-finance-requests.mjs --name "Cintia"
*/

import { createClient } from '@supabase/supabase-js';

const pickArg = (name) => {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const email = pickArg('--email');
const name = pickArg('--name');

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const findUser = async () => {
  if (email) {
    const { data } = await supabase.from('profiles').select('id,name,email,matricula').ilike('email', email).limit(1);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }
  if (name) {
    const { data } = await supabase.from('profiles').select('id,name,email,matricula').ilike('name', `%${name}%`).limit(1);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }
  const { data } = await supabase.from('profiles').select('id,name,email,matricula').limit(1);
  return Array.isArray(data) && data[0] ? data[0] : null;
};

const main = async () => {
  const p = await findUser();
  if (!p?.id) {
    console.error('No profile found to seed against.');
    process.exit(1);
  }

  const created_by = p.id;
  const base = {
    created_by,
    created_by_name: p.name,
    created_by_email: p.email,
    created_by_matricula: p.matricula || null,
    company: 'CPFL Piratininga',
    training_operational: false,
    coordination: 'Planejamento',
    currency: 'BRL',
  };

  const { data: r1, error: e1 } = await supabase
    .from('finance_requests')
    .insert({
      ...base,
      request_kind: 'Reembolso',
      expense_type: 'Transporte',
      date_start: new Date().toISOString().slice(0, 10),
      date_end: null,
      description: 'Seed: solicitação de reembolso (exemplo para testes locais).',
      amount_cents: 12345,
      status: 'Enviado',
    })
    .select('id,protocol')
    .single();
  if (e1) throw e1;

  const { data: r2, error: e2 } = await supabase
    .from('finance_requests')
    .insert({
      ...base,
      request_kind: 'Adiantamento',
      expense_type: 'Adiantamento',
      date_start: new Date().toISOString().slice(0, 10),
      date_end: null,
      description: 'Seed: solicitação de adiantamento (sem valor/anexo).',
      amount_cents: null,
      status: 'Em análise',
    })
    .select('id,protocol')
    .single();
  if (e2) throw e2;

  await supabase.from('finance_request_status_history').insert([
    { request_id: r1.id, changed_by: created_by, from_status: null, to_status: 'Enviado', observation: 'Seed' },
    { request_id: r2.id, changed_by: created_by, from_status: null, to_status: 'Enviado', observation: 'Seed' },
    { request_id: r2.id, changed_by: created_by, from_status: 'Enviado', to_status: 'Em análise', observation: 'Seed' },
  ]);

  console.log('Seed OK:');
  console.log('-', r1.protocol);
  console.log('-', r2.protocol);
};

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

