// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' })
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    // Optional: require leader token to run
    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
    const token = authHeader.slice(7)
    const { data: userData } = await admin.auth.getUser(token)
    const uid = userData?.user?.id
    if (!uid) return res.status(401).json({ error: 'Unauthorized' })

    // Settings
    const { data: settings } = await admin.from('system_settings').select('value').eq('key', 'forumBonus').maybeSingle()
    const enabled = settings?.value?.enabled === true
    const maxPct = typeof settings?.value?.maxPct === 'number' ? Math.max(0, Math.min(0.5, settings.value.maxPct)) : 0.20
    if (!enabled) return res.status(200).json({ success: true, message: 'Forum bonus disabled' })

    // Compute month range
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth()+1, 1).toISOString()

    // Load forum monthly scores (top 10)
    const { data: scores } = await admin
      .from('forum_monthly_scores')
      .select('user_id, final_points')
      .eq('month', ym)
      .order('final_points', { ascending: false })
      .limit(10)

    const filtered = (scores || []).filter(s => (s.final_points || 0) > 0)
    if (!filtered.length) return res.status(200).json({ success: true, message: 'No forum scores for this month' })
    const topScore = Math.max(...filtered.map(s => s.final_points || 0))

    // Compute base_xp per user: quiz + actions in this month
    const userIds = filtered.map(s => s.user_id)
    const { data: quizXp } = await admin
      .from('user_quiz_answers')
      .select('user_id, xp_earned, answered_at')
      .in('user_id', userIds)
      .gte('answered_at', monthStart)
      .lt('answered_at', monthEnd)
    const { data: events } = await admin
      .from('events')
      .select('user_id, final_points, created_at')
      .in('user_id', userIds)
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)

    const baseMap: Record<string, number> = {}
    for (const q of (quizXp || [])) {
      baseMap[q.user_id] = (baseMap[q.user_id] || 0) + (q.xp_earned || 0)
    }
    for (const e of (events || [])) {
      const v = Number(e.final_points || 0)
      if (v > 0) baseMap[e.user_id] = (baseMap[e.user_id] || 0) + v
    }

    const awards = [] as any[]
    for (const row of filtered) {
      const base = baseMap[row.user_id] || 0
      if (base <= 0) continue
      const rel = topScore > 0 ? (row.final_points || 0) / topScore : 0
      // 5% minimum to 20% maximum (configurable)
      const pct = Math.max(0.05, Math.min(maxPct, 0.05 + (maxPct - 0.05) * rel))
      const bonus_xp = Math.floor(base * pct)
      awards.push({ month: ym, user_id: row.user_id, bonus_pct: pct, base_xp: base, bonus_xp })
    }

    if (!awards.length) return res.status(200).json({ success: true, message: 'No eligible users for bonus' })

    // Carregar perfis para exibir nomes/siglas em prévia
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, name, sigla_area')
      .in('id', userIds)

    const profileMap = new Map<string, { name: string | null; sigla_area: string | null }>()
    ;(profiles || []).forEach((p: any) => {
      profileMap.set(p.id, { name: p.name || null, sigla_area: p.sigla_area || null })
    })

    const awardsWithProfile = awards.map((a) => {
      const prof = profileMap.get(a.user_id) || { name: null, sigla_area: null }
      return {
        ...a,
        profile_name: prof.name,
        profile_team: prof.sigla_area,
      }
    })

    // Se for apenas pré-visualização, não grava nem aplica XP
    if (req.method === 'GET') {
      return res.status(200).json({ success: true, preview: true, month: ym, awards: awardsWithProfile })
    }

    // Upsert awards (idempotent), then apply XP
    const { error: awErr } = await admin.from('forum_monthly_bonus_awards').upsert(awards as any, { onConflict: 'month,user_id' } as any)
    if (awErr) return res.status(400).json({ error: awErr.message })

    for (const a of awards) {
      if (a.bonus_xp > 0) {
        await admin.rpc('increment_profile_xp', { _user_id: a.user_id, _delta: a.bonus_xp }).catch(async () => {
          // Fallback if RPC missing: update directly
          const { data: prof } = await admin.from('profiles').select('xp').eq('id', a.user_id).maybeSingle()
          const cur = Number(prof?.xp || 0)
          await admin.from('profiles').update({ xp: cur + a.bonus_xp }).eq('id', a.user_id)
        })
      }
    }

    return res.status(200).json({ success: true, awards: awardsWithProfile })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
