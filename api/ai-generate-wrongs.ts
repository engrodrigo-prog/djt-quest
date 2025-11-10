import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string

const allowedRoles = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase env configuration' })
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' })
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const token = authHeader.slice(7)
    const { data: userData, error: authError } = await admin.auth.getUser(token)
    if (authError || !userData?.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const userId = userData.user.id
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userId)
    const hasPermission = (roles || []).some((row: any) => allowedRoles.has(row.role))
    if (!hasPermission) {
      return res.status(403).json({ error: 'Sem permissão (apenas líderes)' })
    }

    const { question, correct, language = 'pt-BR', difficulty = 'basico', specialties = [], context = '' } = req.body || {}
    if (typeof question !== 'string' || question.trim().length < 5) {
      return res.status(400).json({ error: 'Pergunta inválida' })
    }
    if (typeof correct !== 'string' || correct.trim().length < 5) {
      return res.status(400).json({ error: 'Resposta correta inválida' })
    }

    const system = `Você gera alternativas erradas plausíveis e de alta qualidade para questões de múltipla escolha em ${language}.
Requisitos:
- NUNCA repita a resposta correta nem versões equivalentes.
- Use o nível de dificuldade para calibrar o tipo de erro: basico=conceitos simples, intermediario=pegadinhas comuns, avancado=nuances técnicas, especialista=armadilhas conceituais específicas.
- Considere especialidades e contexto para criar alternativas verossímeis no domínio.
Formato de saída ESTRITO (JSON):
{ "wrong": [ { "text": "...", "explanation": "...", "error_type": "near-miss|misconception|irrelevant", "difficulty_hint": "basico|intermediario|avancado|especialista" }, x4 ] }`

    const userPrompt = `
Pergunta: ${question.trim()}
Resposta correta: ${correct.trim()}
Nível de dificuldade: ${difficulty}
Especialidades: ${(Array.isArray(specialties) ? specialties : []).join(', ') || 'nenhuma'}
Contexto adicional: ${context || 'n/a'}

Gere 4 alternativas erradas verossímeis e explique por que estão incorretas.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.6,
        max_tokens: 600,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      return res.status(400).json({ error: `OpenAI error: ${body}` })
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content || ''
    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch {
      const match = content.match(/\{[\s\S]*\}/)
      if (match) parsed = JSON.parse(match[0])
    }

    if (!parsed || !Array.isArray(parsed.wrong)) {
      return res.status(400).json({ error: 'Formato inesperado da IA', raw: content })
    }

    const wrong = parsed.wrong.slice(0, 4).map((item: any) => ({
      text: typeof item?.text === 'string' ? item.text.trim() : '',
      explanation: item?.explanation ? String(item.explanation).trim() : '',
      error_type: typeof item?.error_type === 'string' ? item.error_type : null,
      difficulty_hint: typeof item?.difficulty_hint === 'string' ? item.difficulty_hint : difficulty,
    }))

    while (wrong.length < 4) {
      wrong.push({ text: '', explanation: '' })
    }

    return res.status(200).json({ success: true, wrong })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
