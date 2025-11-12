import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string

const ALLOWED_ROLES = new Set(['admin','gerente_djt','gerente_divisao_djtx','coordenador_djtx'])

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

    // Check leader permission
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid)
    const hasPermission = (roles || []).some((r: any) => ALLOWED_ROLES.has(r.role))
    if (!hasPermission) return res.status(403).json({ error: 'Sem permissão' })

    const { action, topic_id, post_id, update } = req.body || {}
    if (!action) return res.status(400).json({ error: 'action required' })

    if (action === 'delete_post') {
      if (!post_id) return res.status(400).json({ error: 'post_id required' })
      const { error } = await admin.from('forum_posts').delete().eq('id', post_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'delete_topic') {
      if (!topic_id) return res.status(400).json({ error: 'topic_id required' })
      // cascade via FK will remove posts
      const { error } = await admin.from('forum_topics').delete().eq('id', topic_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'clear_topic') {
      if (!topic_id) return res.status(400).json({ error: 'topic_id required' })
      const { error } = await admin.from('forum_posts').delete().eq('topic_id', topic_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'update_topic') {
      if (!topic_id || typeof update !== 'object') return res.status(400).json({ error: 'topic_id and update required' })
      const safe: any = {}
      if (typeof update.title === 'string' && update.title.trim()) safe.title = update.title.trim()
      if (typeof update.description === 'string') safe.description = update.description
      if (typeof update.status === 'string') safe.status = update.status
      if (Array.isArray(update.tags)) safe.tags = update.tags
      if (Array.isArray(update.quiz_specialties)) safe.quiz_specialties = update.quiz_specialties
      if (typeof update.chas_dimension === 'string') safe.chas_dimension = update.chas_dimension
      const { error } = await admin.from('forum_topics').update(safe).eq('id', topic_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'unknown action' })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }

