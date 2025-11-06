import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectUrl = process.env.SUPABASE_URL || 'https://eyuehdefoedxcunxiyvb.supabase.co';

if (!serviceRoleKey) {
  throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(projectUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const csvPath = path.resolve('src', 'assets', 'cadastro_cpfl_go_import.csv');
if (!fs.existsSync(csvPath)) {
  throw new Error(`CSV não encontrado em ${csvPath}`);
}

const parseCsvLine = (line) => {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(current); current = ''; } else { current += ch; }
  }
  out.push(current);
  return out.map((s) => s.trim());
};

const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(Boolean);
const header = lines[0].split(',');
const colIndex = {
  nome: header.indexOf('nome'),
  email: header.indexOf('email'),
  date_of_birth: header.indexOf('date_of_birth'),
};

if (colIndex.email === -1 || colIndex.date_of_birth === -1) {
  throw new Error('CSV deve conter colunas email e date_of_birth');
}

const updates = lines.slice(1).map((line) => {
  const cols = parseCsvLine(line);
  const email = (cols[colIndex.email] || '').toLowerCase();
  const dob = cols[colIndex.date_of_birth] || null; // YYYY-MM-DD
  return { email, date_of_birth: dob };
}).filter(r => r.email && r.date_of_birth);

const chunk = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
};

const main = async () => {
  console.log(`Atualizando date_of_birth para ${updates.length} registros...`);

  // Map emails to ids
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email');
  if (error) throw error;

  const idByEmail = new Map((profiles || []).map((p) => [String(p.email).toLowerCase(), p.id]));
  const payload = updates
    .map((u) => ({ id: idByEmail.get(u.email), date_of_birth: u.date_of_birth }))
    .filter((u) => u.id);

  if (payload.length === 0) {
    console.log('Nenhum perfil correspondente encontrado.');
    return;
  }

  const batches = chunk(payload, 100);
  let total = 0;
  for (const batch of batches) {
    const { error: upErr } = await supabase.from('profiles').upsert(batch, { onConflict: 'id' });
    if (upErr) throw upErr;
    total += batch.length;
  }

  console.log(`✅ Atualizado date_of_birth em ${total} perfis.`);
};

main().catch((err) => {
  console.error('Erro no backfill de data de nascimento:', err.message);
  process.exit(1);
});

