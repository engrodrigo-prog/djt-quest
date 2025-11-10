import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string

function extractMentionsAndTags(md: string) {
  const mentions = Array.from(md.matchAll(/@([a-zA-Z0-9_.-]+)/g)).map(m => m[1])
  const hashtags = Array.from(md.matchAll(/#([\p{L}0-9_.-]+)/gu)).map(m => m[1].toLowerCase())
  return { mentions, hashtags }
}

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

    const { topic_id, content_md, payload = {}, parent_post_id = null } = req.body || {}
    if (!topic_id || typeof content_md !== 'string' || content_md.trim().length < 1) return res.status(400).json({ error: 'Invalid payload' })

    const { mentions, hashtags } = extractMentionsAndTags(content_md)

    const { data: post, error } = await admin
      .from('forum_posts')
      .insert({ topic_id, user_id: uid, content_md: content_md.trim(), payload, parent_post_id, tags: hashtags })
      .select()
      .single()
    if (error) return res.status(400).json({ error: error.message })

    // Register mentions best-effort
    if (mentions.length) {
      try {
        const { data: users } = await admin.from('profiles').select('id, email, name')
          .in('email', mentions)
        const ids = (users || []).map((u: any) => u.id)
        if (ids.length) {
          const rows = ids.map((id: string) => ({ mentioned_user_id: id, post_id: post.id, topic_id }))
          await admin.from('forum_mentions').insert(rows as any)
        }
      } catch {}
    }

    return res.status(200).json({ success: true, post })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }

