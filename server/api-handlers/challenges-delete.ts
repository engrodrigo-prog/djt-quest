// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' })
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
    const token = authHeader.slice(7)
    const { data: userData } = await admin.auth.getUser(token)
    const uid = userData?.user?.id
    if (!uid) return res.status(401).json({ error: 'Unauthorized' })

    const { id } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })

    // Only leaders/managers/admins can delete quizzes
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid)
    const allowed = new Set(['coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin'])
    if (!roles?.some((r: any) => allowed.has(r.role))) return res.status(403).json({ error: 'Insufficient permissions' })

    // Ensure challenge exists
    const { data: chall, error: chErr } = await admin.from('challenges').select('id, type, title').eq('id', id).maybeSingle()
    if (chErr) return res.status(400).json({ error: chErr.message })
    if (!chall) return res.status(404).json({ error: 'Challenge not found' })

    // 1) Reverter XP de eventos associados a este desafio
    const { data: events } = await admin
      .from('events')
      .select('user_id, final_points, points_calculated')
      .eq('challenge_id', id)

    const xpByUser: Record<string, number> = {}

    ;(events || []).forEach((e: any) => {
      const v = Number(e?.final_points ?? e?.points_calculated ?? 0)
      if (!Number.isFinite(v) || v <= 0 || !e.user_id) return
      xpByUser[e.user_id] = (xpByUser[e.user_id] || 0) + v
    })

    // 2) Reverter XP de quizzes (user_quiz_answers) vinculados a este desafio
    const { data: quizAnswers } = await admin
      .from('user_quiz_answers')
      .select('user_id, xp_earned')
      .eq('challenge_id', id)

    ;(quizAnswers || []).forEach((row: any) => {
      const v = Number(row?.xp_earned || 0)
      if (!Number.isFinite(v) || v <= 0 || !row.user_id) return
      xpByUser[row.user_id] = (xpByUser[row.user_id] || 0) + v
    })

    // 3) Aplicar reversão de XP por usuário usando increment_user_xp (aceita valores negativos)
    for (const [userId, delta] of Object.entries(xpByUser)) {
      const xpToRemove = Math.round(delta)
      if (!userId || !Number.isFinite(xpToRemove) || xpToRemove <= 0) continue
      try {
        await admin.rpc('increment_user_xp', { _user_id: userId, _xp_to_add: -xpToRemove })
      } catch {
        // Fallback: ajuste direto de XP caso RPC não exista
        try {
          const { data: prof } = await admin.from('profiles').select('xp').eq('id', userId).maybeSingle()
          const cur = Number(prof?.xp || 0)
          const next = Math.max(0, cur - xpToRemove)
          await admin.from('profiles').update({ xp: next }).eq('id', userId)
        } catch {}
      }
    }

    // 4) Remover registros relacionados (eventos, respostas de quiz, tentativas)
    await admin.from('events').delete().eq('challenge_id', id)
    await admin.from('user_quiz_answers').delete().eq('challenge_id', id)
    // quiz_attempts pode não existir em todos os ambientes; ignore erro se não existir
    try {
      await admin.from('quiz_attempts').delete().eq('challenge_id', id)
    } catch {}

    // 5) Remover o desafio em si (FKs em quiz_questions/options e events têm ON DELETE CASCADE)
    const { error: delErr } = await admin.from('challenges').delete().eq('id', id)
    if (delErr) return res.status(400).json({ error: delErr.message })
    return res.status(200).json({ success: true })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
