// @ts-nocheck
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

    const topicId = String(req.query.topic_id || '').trim()
    const range = String(req.query.range || 'quarter')
    const now = new Date()
    let start: Date
    if (range === 'week') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
    } else if (range === 'month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    } else if (range === 'semester') {
      start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
    } else if (range === 'year') {
      start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    } else {
      // quarter ou default: últimos ~90 dias
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90)
    }
    const startIso = start.toISOString()

    // Caso específico: insights para um único fórum (topic_id)
    if (topicId) {
      const [{ data: topic, error: topicErr }, { data: posts, error: postsErr }] = await Promise.all([
        admin.from('forum_topics').select('id,title,description,chas_dimension,quiz_specialties,tags').eq('id', topicId).maybeSingle(),
        admin.from('forum_posts').select('id,content_md,ai_assessment,created_at').eq('topic_id', topicId).order('created_at', { ascending: true }),
      ])
      if (topicErr) return res.status(400).json({ error: topicErr.message })
      if (!topic) return res.status(404).json({ error: 'Tópico não encontrado' })
      if (postsErr) return res.status(400).json({ error: postsErr.message })

      const allTexts = (posts || []).map((p: any) => ({
        id: p.id,
        created_at: p.created_at,
        content: p.content_md,
        ai_assessment: p.ai_assessment || null,
      }))

      let items: any[] = []
      if (OPENAI_API_KEY && allTexts.length) {
        const system = 'Você é um consultor técnico da DJT (CPFL) que organiza debates de fórum profissional. Use linguagem técnica, neutra e objetiva (pt-BR).'
        const premium = process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_OVERRIDE || 'gpt-4.1'
        const body: any = {
          model: premium,
          temperature: 0.4,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `Tema do fórum: ${topic.title}\nDescrição: ${topic.description || ''}\nCHAS: ${topic.chas_dimension || 'C'}\nEspecialidades: ${(topic.quiz_specialties || []).join(', ')}\nTags: ${(topic.tags || []).join(', ')}\n\nPosts (em ordem cronológica):\n${JSON.stringify(allTexts, null, 2)}\n\nObjetivo:\n- Aplicar a lógica 80/20: identificar os ~20% de ideias/assuntos que geram ~80% do impacto.\n- Destacar no MÁXIMO 5 destaques (temas) para este fórum específico.\n- Para o conjunto do fórum, sugerir no MÁXIMO 5 ações concretas (operacionais, de aprendizado ou de alinhamento).\n\nRetorne JSON estrito no formato:\n{\n  \"items\": [\n    {\n      \"topic_id\": \"${topic.id}\",\n      \"title\": \"título curto do destaque\",\n      \"priority\": 1-5,\n      \"chas\": \"C|H|A|S\",\n      \"specialties\": [\"seguranca\"|\"protecao_automacao\"|\"telecom\"|\"equipamentos_manobras\"|\"instrumentacao\"|\"gerais\"],\n      \"summary\": \"resumo em 2-3 frases do que foi discutido nesse destaque\",\n      \"proposed_actions\": [\n        {\n          \"type\": \"quiz\"|\"desafio\"|\"campanha\"|\"operacional\",\n          \"title\": \"nome da ação\",\n          \"description\": \"descrição objetiva da ação\",\n          \"target\": \"equipes\"|\"lideres\"|\"organizacao\"|\"outras_areas\"\n        }\n      ],\n      \"justification\": \"porque este destaque está entre os 20% de maior impacto\"\n    }\n  ]\n}\n\nRegras adicionais:\n- Máximo de 5 itens em \"items\".\n- No conjunto, máximo de 5 ações realmente distintas (evite repetições triviais).\n- Não cite dados sensíveis ou nomes completos de pessoas.\n`,
            },
          ],
        }
        if (/^gpt-5/i.test(String(premium))) body.max_completion_tokens = 1800
        else body.max_tokens = 1800

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify(body),
        })
        if (resp.ok) {
          const dj = await resp.json()
          const text = dj?.choices?.[0]?.message?.content || ''
          try {
            const parsed = JSON.parse(text)
            if (Array.isArray(parsed?.items)) items = parsed.items.slice(0, 5)
          } catch {
            const m = text.match(/\{[\s\S]*\}/)
            if (m) {
              try {
                const parsed = JSON.parse(m[0])
                if (Array.isArray(parsed?.items)) items = parsed.items.slice(0, 5)
              } catch {}
            }
          }
        }
      }

      if (!items.length) {
        // Fallback: um único destaque genérico baseado no tema
        items = [
          {
            topic_id: topic.id,
            title: topic.title,
            priority: 3,
            chas: topic.chas_dimension || 'C',
            specialties: topic.quiz_specialties || [],
            summary: 'Destaque principal deste fórum com base no volume de mensagens e na relevância para a operação.',
            proposed_actions: [
              {
                type: 'quiz',
                title: `Quiz sobre ${topic.title}`,
                description: 'Avaliar o nível de conhecimento dos times sobre o tema discutido.',
                target: 'equipes',
              },
            ],
            justification: 'Fallback quando a IA não está disponível: uso de regra simples de priorização.',
          },
        ]
      }

      return res.status(200).json({ success: true, items })
    }

    // Caso global (sem topic_id): consolidar últimos tópicos pelo período selecionado
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
      const premium = process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_OVERRIDE || 'gpt-4.1'
      const base: any = {
        model: premium, temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Considere estes tópicos com métricas:\n${JSON.stringify(top, null, 2)}\nRegras: priorize Segurança (S) quando aplicável; alinhe com CHAS (Conhecimento/Habilidade/Atitude/Segurança).\nRetorne JSON estrito: {"items":[{ "topic_id":"uuid","title":"...","priority":1-5,"chas":"C|H|A|S","specialties":[...],"summary":"...","proposed_actions":[{"type":"quiz|desafio|campanha|operacional","title":"...","description":"...","target":"equipes|lideres|organizacao|outras_areas"}],"justification":"..." } ×10]}` }
        ]
      }
      if (/^gpt-5/i.test(String(premium))) base.max_completion_tokens = 1500; else base.max_tokens = 1500
      const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify(base) })
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
