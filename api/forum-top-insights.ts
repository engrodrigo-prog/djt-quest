import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' })
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    const range = String(req.query.range || 'last-90-days')
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90)
    const startIso = start.toISOString()

    const [{ data: topics }, { data: posts }, { data: reacts }] = await Promise.all([
      admin.from('forum_topics').select('id,title,description,chas_dimension,quiz_specialties,tags,created_at').gte('created_at', startIso),
      admin.from('forum_posts').select('id,topic_id,ai_assessment,created_at').gte('created_at', startIso),
      admin.from('forum_reactions').select('post_id,type').gte('created_at', startIso)
    ])

    const metrics = (topics || []).map(t => {
      const tp = (posts || []).filter(p => p.topic_id === t.id)
      const pr = (reacts || []).filter(r => tp.some(p => p.id === r.post_id))
      const count = tp.length
      const help = avg(tp.map(p => Number(p.ai_assessment?.helpfulness || 0)))
      const clar = avg(tp.map(p => Number(p.ai_assessment?.clarity || 0)))
      const nov = avg(tp.map(p => Number(p.ai_assessment?.novelty || 0)))
      const tox = avg(tp.map(p => Number(p.ai_assessment?.toxicity || 0)))
      const safetyBias = (t.chas_dimension === 'S' || (t.tags || []).includes('seguranca')) ? 1 : 0
      const reactions = pr.length
      const score = (count * 0.3) + (reactions * 0.2) + ((help + clar + nov) * 0.4) - (tox * 0.2) + (safetyBias * 0.4)
      return { topic_id: t.id, title: t.title, chas: t.chas_dimension, specialties: t.quiz_specialties || [], score, count, reactions,
        help: round(help), clar: round(clar), nov: round(nov), tox: round(tox), tags: t.tags || [] }
    }).sort((a,b)=> b.score - a.score)

    const top = metrics.slice(0, 10)

    // Prepare prompt for AI (if key present)
    let items: any[] = []
    if (OPENAI_API_KEY) {
      const system = 'Você é um consultor de aprendizado corporativo (pt-BR). Atribua prioridades e proponha ações (quiz/desafio/campanha/operacional) com escopo (equipes, líderes, toda organização, ou outras áreas) a partir dos tópicos do fórum.'
      const prompt = {
        model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 1500,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Considere estes tópicos com métricas:\n${JSON.stringify(top, null, 2)}\nRegras: priorize Segurança (S) quando aplicável; alinhe com CHAS (Conhecimento/Habilidade/Atitude/Segurança).\nRetorne JSON estrito: {"items":[{ "topic_id":"uuid","title":"...","priority":1-5,"chas":"C|H|A|S","specialties":[...],"summary":"...","proposed_actions":[{"type":"quiz|desafio|campanha|operacional","title":"...","description":"...","target":"equipes|lideres|organizacao|outras_areas"}],"justification":"..." } ×10]}` }
        ]
      }
      const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify(prompt) })
      if (resp.ok) {
        const dj = await resp.json()
        const text = dj?.choices?.[0]?.message?.content || ''
        try {
          const parsed = JSON.parse(text)
          if (Array.isArray(parsed?.items)) items = parsed.items
        } catch {
          const m = text.match(/\{[\s\S]*\}/)
          if (m) {
            try { const parsed = JSON.parse(m[0]); if (Array.isArray(parsed?.items)) items = parsed.items } catch {}
          }
        }
      }
    }

    if (!items.length) {
      // Fallback: naive mapping of top metrics
      items = top.map((m, idx) => ({ topic_id: m.topic_id, title: m.title, priority: Math.max(1, 5 - Math.floor(idx/2)), chas: m.chas || 'C', specialties: m.specialties || [], summary: 'Tópico prioritário pelo engajamento/qualidade.', proposed_actions: [ { type: 'quiz', title: `Quiz: ${m.title}`, description: 'Avaliar conhecimento atual.', target: 'organizacao' } ], justification: 'Métricas de posts/reactions/qualidade.' }))
    }

    // Persist insight snapshot for audit (leaders only via RLS insert; service key can always write)
    try {
      await admin.from('forum_insights').insert({ scope: 'last-90-days', items })
    } catch {}

    return res.status(200).json({ success: true, items })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

function avg(arr: number[]) { if (!arr.length) return 0; return arr.reduce((a,b)=>a+b,0)/arr.length }
function round(n: number) { return Math.round(n*100)/100 }

export const config = { api: { bodyParser: false } }

