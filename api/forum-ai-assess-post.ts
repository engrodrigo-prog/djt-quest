import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' })
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' })
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    const { post_id } = req.body || {}
    if (!post_id) return res.status(400).json({ error: 'post_id required' })
    const { data: post, error: pErr } = await admin.from('forum_posts').select('id, content_md').eq('id', post_id).single()
    if (pErr || !post) return res.status(404).json({ error: 'post not found' })

    const system = 'Classifique posts de fórum (pt-BR): retorne JSON { helpfulness:0..1, clarity:0..1, novelty:0..1, toxicity:0..1, chas:"C|H|A|S", tags:[..], flags:[..] }.'
    const user = `POST:\n${post.content_md}`
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, max_tokens: 300, messages: [{ role:'system', content: system }, { role:'user', content: user }] })
    })
    if (!resp.ok) { const t = await resp.text(); return res.status(400).json({ error: `OpenAI error: ${t}` }) }
    const data = await resp.json()
    const content = data?.choices?.[0]?.message?.content || ''
    let json: any
    try { json = JSON.parse(content) } catch { const m = content.match(/\{[\s\S]*\}/); if (m) json = JSON.parse(m[0]) }
    if (!json) return res.status(400).json({ error: 'Bad AI format', raw: content })

    await admin.from('forum_posts').update({ ai_assessment: json, tags: json.tags || null }).eq('id', post_id)
    return res.status(200).json({ success: true, assessment: json })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }

