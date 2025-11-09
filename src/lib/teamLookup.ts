import { supabase } from '@/integrations/supabase/client'

const toIdArray = (teamIds: (string | null | undefined)[]) => {
  const set = new Set<string>()
  for (const id of teamIds) {
    if (id) set.add(id)
  }
  return Array.from(set)
}

export async function fetchTeamNames(teamIds: (string | null | undefined)[]) {
  const ids = toIdArray(teamIds)
  if (!ids.length) return {}

  try {
    const { data, error } = await supabase
      .from('teams')
      .select('id, name')
      .in('id', ids)

    if (error || !data) {
      console.warn('Não foi possível carregar nomes das equipes:', error?.message)
      return {}
    }

    return data.reduce<Record<string, string | null>>((acc, team) => {
      acc[team.id] = team.name || null
      return acc
    }, {})
  } catch (err) {
    console.warn('Erro ao buscar equipes (talvez tabela indisponível):', err)
    return {}
  }
}
