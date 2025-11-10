import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase server configuration' })
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' })
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

    const { topic, difficulty = 'basico', language = 'pt-BR' } = req.body || {}
    if (!topic || typeof topic !== 'string') return res.status(400).json({ error: 'Informe um tema (topic)' })

    const system = `Você é um gerador de questões de múltipla escolha para treinamento corporativo em ${language}. Gere 1 questão objetiva sobre o tema fornecido. Inclua:
 - question: enunciado curto e claro (sem numeração)
 - correct: { text, explanation }
 - wrong: lista com exatamente 3 itens { text, explanation } cada (distratores plausíveis, mas incorretos)
Responda apenas em JSON válido, sem comentários.`

    const user = {
      role: 'user',
      content: `Tema: ${topic}\nDificuldade: ${difficulty}\nRetorne no formato:\n{ "question": "...", "correct": {"text":"...","explanation":"..."}, "wrong": [{"text":"...","explanation":"..."},{"text":"...","explanation":"..."},{"text":"...","explanation":"..."}] }`,
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          user,
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    })

    if (!resp.ok) {
      const t = await resp.text()
      return res.status(400).json({ error: `OpenAI error: ${t}` })
    }
    const data = await resp.json()
    const content = data?.choices?.[0]?.message?.content || ''
    let json: any
    try {
      json = JSON.parse(content)
    } catch {
      // tentar extrair bloco JSON
      const match = content.match(/\{[\s\S]*\}/)
      if (match) json = JSON.parse(match[0])
    }
    if (!json || !json.question || !json.correct || !Array.isArray(json.wrong)) {
      return res.status(400).json({ error: 'Resposta da IA em formato inesperado', raw: content })
    }

    return res.status(200).json({ success: true, draft: json })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
