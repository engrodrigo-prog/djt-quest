import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !service) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supa = createClient(url, service)

const { data: profileTeams, error: pErr } = await supa
  .from('profiles')
  .select('team_id')
  .not('team_id', 'is', null)

if (pErr) {
  console.error('Erro lendo perfis:', pErr.message)
  process.exit(1)
}

const allowed = new Set((profileTeams || []).map((r) => r.team_id))

const { data: allTeams, error: tErr } = await supa.from('teams').select('id')
if (tErr) {
  console.error('Erro lendo equipes:', tErr.message)
  process.exit(1)
}

const toDelete = (allTeams || []).map((t) => t.id).filter((id) => !allowed.has(id))

if (toDelete.length === 0) {
  console.log('Nenhuma equipe extra para remover')
  process.exit(0)
}

console.log('Removendo equipes não utilizadas:', toDelete.length)
const { error: delErr } = await supa.from('teams').delete().in('id', toDelete)
if (delErr) {
  console.error('Falha ao remover equipes:', delErr.message)
  process.exit(1)
}

console.log('Limpeza concluída.')

