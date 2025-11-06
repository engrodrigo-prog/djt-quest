import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase server configuration' })
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Auth + permission check (leaders only)
    const authHeader = (req.headers['authorization'] as string | undefined) || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' })
    const callerId = userData.user.id
    const { data: roles } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', callerId)
    const allowed = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx'])
    const hasPermission = (roles || []).some((r: any) => allowed.has(r.role))
    if (!hasPermission) return res.status(403).json({ error: 'Sem permissão (apenas líderes)' })

    const { email, userId, updates } = req.body || {}
    if (!email && !userId) return res.status(400).json({ error: 'Informe email ou userId' })

    // Sanitize allowed fields
    const payload: any = {}
    if (updates && typeof updates === 'object') {
      if (typeof updates.matricula === 'string') payload.matricula = updates.matricula.trim()
      if (typeof updates.date_of_birth === 'string') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(updates.date_of_birth.trim())) {
          return res.status(400).json({ error: 'date_of_birth deve estar no formato YYYY-MM-DD' })
        }
        payload.date_of_birth = updates.date_of_birth.trim()
      }
      if (typeof updates.sigla_area === 'string') payload.sigla_area = updates.sigla_area.trim().toUpperCase()
      if (typeof updates.operational_base === 'string') payload.operational_base = updates.operational_base.trim()
    }
    if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'Nenhuma atualização válida recebida' })

    let targetId = userId
    if (!targetId && email) {
      const { data: prof } = await supabaseAdmin.from('profiles').select('id').eq('email', email.toLowerCase()).maybeSingle()
      targetId = prof?.id
    }
    if (!targetId) return res.status(404).json({ error: 'Usuário não encontrado' })

    const { error: updErr } = await supabaseAdmin.from('profiles').update(payload).eq('id', targetId)
    if (updErr) return res.status(400).json({ error: updErr.message })

    const { data: updated } = await supabaseAdmin.from('profiles').select('id, email, name, matricula, date_of_birth, sigla_area, operational_base').eq('id', targetId).single()
    return res.status(200).json({ success: true, profile: updated })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }

