// @ts-nocheck
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

    // Summarize with premium model (curation)
    const system = 'Você é um curador que organiza discussões de fórum em português (pt-BR) em um compêndio claro, objetivo e acionável.'
    const ask = {
      summary: 'RESUMO em Markdown (curto e claro)',
      key: 'APRENDIZADOS-CHAVE (5-8 bullets objetivos)',
      quizzes: 'SUGESTOES DE QUIZ: até 3 perguntas (title, description)',
      challenges: 'SUGESTOES DE DESAFIOS/CAMPANHAS: até 2 (title, description)'
    }
    const userContent = `Organize os principais pontos da discussão abaixo e retorne JSON estrito no formato:\n{ "summary_md":"...", "key_learnings":["..."], "suggested_quizzes":[{"title":"...","description":"..."}], "suggested_challenges":[{"title":"...","description":"..."}] }\n\nRegras:\n- Seja objetivo, linguagem profissional mas humana\n- Evite duplicações entre quizzes e desafios\n- Alinhe com CHAS quando pertinente\n\nDiscussão:\n${corpus}`

    const premium = process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_OVERRIDE || 'gpt-5.2-thinking'
    const tryModels = Array.from(new Set([premium, 'gpt-4.1', 'gpt-4o'].filter(Boolean)))
    let out = ''
    let lastErr = ''
    for (const model of tryModels) {
      const body: any = { model, temperature: 0.3, messages: [ { role: 'system', content: system }, { role: 'user', content: userContent } ] }
      if (/^gpt-5/i.test(model)) body.max_completion_tokens = 1400; else body.max_tokens = 1400
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify(body)
      })
      if (!resp.ok) { lastErr = await resp.text().catch(()=>`HTTP ${resp.status}`); continue }
      const data = await resp.json().catch(()=>null)
      out = data?.choices?.[0]?.message?.content || ''
      if (out) break
    }
    if (!out) return res.status(400).json({ error: `OpenAI error: ${lastErr || 'no output'}` })

    // Parse JSON
    let parsed: any = null
    try { parsed = JSON.parse(out) } catch {
      const m = out.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]) } catch {} }
    }
    if (!parsed) parsed = { summary_md: out, key_learnings: null, suggested_quizzes: null, suggested_challenges: null }
    const summary_md = String(parsed.summary_md || out)
    const key_learnings = Array.isArray(parsed.key_learnings) ? parsed.key_learnings : null
    const suggested_quizzes = Array.isArray(parsed.suggested_quizzes) ? parsed.suggested_quizzes : null
    const suggested_challenges = Array.isArray(parsed.suggested_challenges) ? parsed.suggested_challenges : null

    // Persist compendium and close topic (final)
    await admin.from('forum_compendia').upsert({
      topic_id,
      closed_by: uid,
      closed_at: new Date().toISOString(),
      summary_md,
      key_learnings,
      suggested_quizzes,
      suggested_challenges,
    } as any, { onConflict: 'topic_id' } as any)
    await admin.from('forum_topics').update({ status: 'closed' }).eq('id', topic_id)

    return res.status(200).json({ success: true, compendium: { summary_md, key_learnings, suggested_quizzes, suggested_challenges } })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
