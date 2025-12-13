// @ts-nocheck
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx'])
const ADMIN_ROLES = new Set(['admin', 'gerente_djt'])

const parseBool = (value) => {
  const s = String(value ?? '').toLowerCase().trim()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

const parseLimit = (value, fallback = 100) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(500, Math.floor(n)))
}

const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)))

const parseStorageRefFromUrl = (raw) => {
  try {
    const url = new URL(raw)
    const path = url.pathname
    // public object
    let m = path.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) }
    // signed object
    m = path.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) }
    return null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase server configuration' })
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const authHeader = (req.headers['authorization'] || '')
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    if (!token) return res.status(401).json({ error: 'Unauthorized' })

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' })

    const callerId = userData.user.id
    const { data: roles } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', callerId)
    const callerRoles = (roles || []).map((r) => r.role)
    const isStaff = callerRoles.some((r) => STAFF_ROLES.has(r))
    const isAdmin = callerRoles.some((r) => ADMIN_ROLES.has(r))
    if (!isStaff) return res.status(403).json({ error: 'Sem permissão' })

    if (req.method === 'GET') {
      const q = String(req.query?.q || '').trim()
      const scope = String(req.query?.scope || '').toLowerCase().trim() // 'mine' | 'all'
      const limit = parseLimit(req.query?.limit, 120)
      const userId = String(req.query?.user_id || '').trim()
      const onlyMine = scope === 'mine' || parseBool(req.query?.only_mine)

      let query = supabaseAdmin
        .from('study_sources')
        .select(
          'id, user_id, title, kind, url, storage_path, summary, topic, ingest_status, ingested_at, ingest_error, is_persistent, created_at, last_used_at',
        )
        .order('created_at', { ascending: false })
        .limit(limit)

      if (!isAdmin || onlyMine) {
        query = query.eq('user_id', callerId)
      } else if (userId) {
        query = query.eq('user_id', userId)
      }

      if (q) {
        const safe = q.replace(/[%]/g, '')
        query = query.or(`title.ilike.%${safe}%,summary.ilike.%${safe}%,url.ilike.%${safe}%`)
      }

      const { data, error } = await query
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ items: data || [], isAdmin })
    }

    const body = (req.body || {})
    const action = String(body.action || 'delete').toLowerCase().trim()
    const deleteStorage = body.deleteStorage !== false

    if (action !== 'delete') {
      return res.status(400).json({ error: 'Ação inválida' })
    }

    const ids = Array.isArray(body.ids) ? uniq(body.ids.map((x) => String(x || '').trim())) : []
    if (!ids.length) return res.status(400).json({ error: 'Informe ids' })

    // Carregar itens antes para poder remover arquivos
    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('study_sources')
      .select('id, user_id, kind, url, storage_path')
      .in('id', ids)
    if (fetchErr) return res.status(400).json({ error: fetchErr.message })

    // Se não for admin, restringe ao próprio usuário (defesa extra)
    if (!isAdmin) {
      const unauthorized = (rows || []).some((r) => r.user_id !== callerId)
      if (unauthorized) return res.status(403).json({ error: 'Sem permissão para excluir fontes de outros usuários' })
    }

    if (deleteStorage) {
      const toRemove = []
      for (const r of rows || []) {
        const ref = r?.url ? parseStorageRefFromUrl(r.url) : null
        if (ref) toRemove.push(ref)
        // Fallback: uploads do StudyLab usam bucket evidence e prefixo study
        if (!ref && r?.storage_path && String(r.storage_path).includes('/')) {
          const p = String(r.storage_path)
          if (p.startsWith('study/')) {
            toRemove.push({ bucket: 'evidence', path: p })
          }
        }
      }
      const grouped = new Map()
      for (const r of toRemove) {
        const list = grouped.get(r.bucket) || []
        list.push(r.path)
        grouped.set(r.bucket, list)
      }
      for (const [bucket, paths] of grouped.entries()) {
        try {
          await supabaseAdmin.storage.from(bucket).remove(uniq(paths))
        } catch {
          // best-effort
        }
      }
    }

    const { error: delErr } = await supabaseAdmin.from('study_sources').delete().in('id', ids)
    if (delErr) return res.status(400).json({ error: delErr.message })

    return res.status(200).json({ success: true, deleted: ids.length })
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
