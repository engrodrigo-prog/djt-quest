import { createClient } from '@supabase/supabase-js';
import { assertDjtQuestSupabaseUrl } from '../server/env-guard.js';

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectUrl = process.env.SUPABASE_URL || 'https://eyuehdefoedxcunxiyvb.supabase.co';

assertDjtQuestSupabaseUrl(projectUrl, { allowLocal: true, envName: 'SUPABASE_URL' });

if (!serviceRoleKey) {
  throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(projectUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const main = async () => {
  console.log('🔎 Buscando divisões simuladas (DJTX*, DJTV*)...');
  let divisions = [];
  let divisionIds = [];
  let divisionLookupAvailable = true;
  try {
    const res = await supabase
      .from('divisions')
      .select('id, name')
      .or('name.ilike.DJTX%,name.ilike.DJTV%');
    if (res.error) throw res.error;
    divisions = res.data || [];
    divisionIds = divisions.map((d) => d.id);
  } catch (err) {
    divisionLookupAvailable = false;
    console.warn('Divisions table indisponível. Fallback para limpeza por equipes.', err?.message || err);
  }
  if (divisionLookupAvailable) {
    console.log('Divisões a remover:', divisions.map((d) => d.name));
  }

  // Mapear coordenações e equipes
  let coordIds = [];
  if (divisionLookupAvailable && divisionIds.length) {
    const { data: coords, error: coordErr } = await supabase
      .from('coordinations')
      .select('id, name')
      .in('division_id', divisionIds);
    if (coordErr) throw coordErr;
    coordIds = (coords || []).map((c) => c.id);
  }

  let teamIds = [];
  // Buscar equipes por coordenação (quando há divisões) e por nome (fallback)
  if (coordIds.length) {
    const { data: teams, error: teamErr } = await supabase
      .from('teams')
      .select('id, name')
      .in('coordination_id', coordIds);
    if (teamErr) throw teamErr;
    teamIds = (teams || []).map((t) => t.id);
  } else {
    try {
      const { data: teamsByName, error: teamNameErr } = await supabase
        .from('teams')
        .select('id, name')
        .or('name.ilike.DJTX%,name.ilike.DJTV%');
      if (teamNameErr) throw teamNameErr;
      teamIds = (teamsByName || []).map((t) => t.id);
    } catch (e) {
      console.warn('Teams table indisponível. Fallback para limpar perfis por sigla.', e?.message || e);
    }
  }

  console.log(`Encontradas ${divisionIds.length} divisões, ${coordIds.length} coordenações, ${teamIds.length} equipes`);

  // Limpar referências em profiles
  console.log('🧹 Limpando referências em perfis...');
  if (teamIds.length) {
    const { error } = await supabase.from('profiles').update({ team_id: null }).in('team_id', teamIds);
    if (error) throw error;
  }
  if (coordIds.length) {
    const { error } = await supabase.from('profiles').update({ coord_id: null }).in('coord_id', coordIds);
    if (error) throw error;
  }
  if (divisionLookupAvailable && divisionIds.length) {
    const { error } = await supabase.from('profiles').update({ division_id: null }).in('division_id', divisionIds);
    if (error) throw error;
  }

  // Fallback: se não há tabelas divisions/teams, limpe perfis por sigla/base (DJTX*, DJTV*)
  if (!divisionLookupAvailable && teamIds.length === 0) {
    console.log('🧹 Fallback: limpando perfis com sigla/base simuladas (DJTX*, DJTV*)');
    const { error: p1 } = await supabase
      .from('profiles')
      .update({ sigla_area: null, operational_base: null })
      .or('sigla_area.ilike.DJTX%,sigla_area.ilike.DJTV%');
    if (p1) throw p1;
    const { error: p2 } = await supabase
      .from('profiles')
      .update({ sigla_area: null, operational_base: null })
      .or('operational_base.ilike.DJTX%,operational_base.ilike.DJTV%');
    if (p2) throw p2;
  }

  // Limpar arrays em challenges (target_*_ids)
  let updatedChallenges = 0;
  try {
    console.log('🧹 Limpando referências em challenges...');
    const { data: challenges, error: chalErr } = await supabase
      .from('challenges')
      .select('id, target_team_ids, target_coord_ids, target_div_ids');
    if (chalErr) throw chalErr;
    const tSet = new Set(teamIds);
    const cSet = new Set(coordIds);
    const dSet = new Set(divisionIds);
    const toUpdate = [];
    for (const ch of challenges || []) {
      const newTeams = Array.isArray(ch.target_team_ids) ? ch.target_team_ids.filter((id) => !tSet.has(id)) : null;
      const newCoords = Array.isArray(ch.target_coord_ids) ? ch.target_coord_ids.filter((id) => !cSet.has(id)) : null;
      const newDivs = Array.isArray(ch.target_div_ids) ? ch.target_div_ids.filter((id) => !dSet.has(id)) : null;
      const changed =
        JSON.stringify(newTeams) !== JSON.stringify(ch.target_team_ids || null) ||
        JSON.stringify(newCoords) !== JSON.stringify(ch.target_coord_ids || null) ||
        JSON.stringify(newDivs) !== JSON.stringify(ch.target_div_ids || null);
      if (changed) toUpdate.push({ id: ch.id, target_team_ids: newTeams, target_coord_ids: newCoords, target_div_ids: newDivs });
    }
    for (const batch of chunk(toUpdate, 50)) {
      const { error } = await supabase.from('challenges').upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      updatedChallenges += batch.length;
    }
  } catch (err) {
    console.warn('Tabela challenges indisponível, salto da limpeza de alvos.', err?.message || err);
  }
  if (updatedChallenges) {
    console.log(`Challenges atualizados: ${updatedChallenges}`);
  }

  // Apagar equipes e coordenações e divisões
  console.log('🗑️ Removendo equipes, coordenações e divisões simuladas...');
  if (teamIds.length) {
    const { error } = await supabase.from('teams').delete().in('id', teamIds);
    if (error) throw error;
  }
  if (coordIds.length) {
    const { error } = await supabase.from('coordinations').delete().in('id', coordIds);
    if (error) throw error;
  }
  if (divisionLookupAvailable && divisionIds.length) {
    const { error } = await supabase.from('divisions').delete().in('id', divisionIds);
    if (error) throw error;
  }

  console.log('✅ Limpeza concluída.');
};

main().catch((err) => {
  console.error('Erro na limpeza de divisões simuladas:', err?.message || err);
  process.exit(1);
});
