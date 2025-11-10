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
    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
    const token = authHeader.slice(7)
    const { data: userData } = await admin.auth.getUser(token)
    const uid = userData?.user?.id
    if (!uid) return res.status(401).json({ error: 'Unauthorized' })

    const { topic_id } = req.body || {}
    if (!topic_id) return res.status(400).json({ error: 'topic_id required' })

    // Load posts
    const { data: posts, error: pErr } = await admin
      .from('forum_posts')
      .select('content_md, payload, user_id, created_at')
      .eq('topic_id', topic_id)
      .order('created_at')
    if (pErr) return res.status(400).json({ error: pErr.message })

    const corpus = (posts || []).map((p: any) => `- (${new Date(p.created_at).toISOString()}) ${p.content_md}`).join('\n')

    // Summarize
    const system = 'Você é um curador que organiza discussões de fórum em português (pt-BR) em um compêndio claro, objetivo e acionável.'
    const prompt = `Organize os principais pontos da discussão abaixo. Produza:\n1) RESUMO em Markdown, curto e claro.\n2) APRENDIZADOS-CHAVE: 5-8 bullets objetivos.\n3) SUGESTOES: até 3 perguntas de quiz e até 2 desafios/campanhas (títulos, 1-2 linhas cada).\n\nDiscussão:\n${corpus}`
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 1400, messages: [ { role: 'system', content: system }, { role: 'user', content: prompt } ] })
    })
    if (!resp.ok) {
      const t = await resp.text();
      return res.status(400).json({ error: `OpenAI error: ${t}` })
    }
    const data = await resp.json()
    const out = data?.choices?.[0]?.message?.content || ''

    // naive parsing into sections
    const parts = out.split(/\n\s*\d\)\s*/)
    const summary_md = out
    const comp = { summary_md, key_learnings: null, suggested_quizzes: null, suggested_challenges: null }

    // Persist compendium and close topic
    await admin.from('forum_compendia').upsert({ topic_id, closed_by: uid, closed_at: new Date().toISOString(), summary_md }, { onConflict: 'topic_id' })
    await admin.from('forum_topics').update({ status: 'closed' }).eq('id', topic_id)

    return res.status(200).json({ success: true, compendium: comp })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }

