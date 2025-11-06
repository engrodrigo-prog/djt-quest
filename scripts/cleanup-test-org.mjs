import { createClient } from '@supabase/supabase-js'

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const projectUrl = process.env.SUPABASE_URL

if (!serviceRoleKey || !projectUrl) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(projectUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TEST_DIVISIONS = ['DJTX', 'DJT ABC', 'DJT-ABC']

const run = async () => {
  console.log('🔎 Removendo divisões de teste:', TEST_DIVISIONS.join(', '))
  for (const div of TEST_DIVISIONS) {
    // Find coordinations under this division
    const { data: coords } = await supabase.from('coordinations').select('id').eq('division_id', div)
    const coordIds = (coords || []).map((c) => c.id)

    // Find teams under these coordinations
    let teamIds = []
    if (coordIds.length) {
      const { data: teams } = await supabase.from('teams').select('id').in('coord_id', coordIds)
      teamIds = (teams || []).map((t) => t.id)
    }

    // Null out references from profiles before deleting org units
    if (teamIds.length) {
      await supabase.from('profiles').update({ team_id: null }).in('team_id', teamIds)
    }
    if (coordIds.length) {
      await supabase.from('profiles').update({ coord_id: null }).in('coord_id', coordIds)
    }
    await supabase.from('profiles').update({ division_id: null }).eq('division_id', div)

    // Delete teams, coordinations, division
    if (teamIds.length) await supabase.from('teams').delete().in('id', teamIds)
    if (coordIds.length) await supabase.from('coordinations').delete().in('id', coordIds)
    await supabase.from('divisions').delete().eq('id', div)

    console.log(`🧹 Removida estrutura de ${div}`)
  }
}

run().catch((e) => {
  console.error('Erro na limpeza:', e?.message || e)
  process.exit(1)
})
