// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { proofreadPtBrStrings } from '../lib/ai-proofread-ptbr'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string

const XP_BY_LEVEL: Record<string, number> = {
  // precisa respeitar o CHECK do banco (5,10,20,50)
  basico: 5,
  intermediario: 10,
  avancado: 20,
  especialista: 50,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase server configuration' })
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const authHeader = req.headers['authorization'] as string | undefined
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    if (!token) return res.status(401).json({ error: 'Unauthorized' })

    const { data: userResp, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !userResp?.user) return res.status(401).json({ error: 'Unauthorized' })
    const userId = userResp.user.id

    const { challengeId, question_text, difficulty_level, options, skip_proofread } = req.body || {}
    if (!challengeId || !question_text || !difficulty_level || !Array.isArray(options)) {
      return res.status(400).json({ error: 'Campos obrigatórios: challengeId, question_text, difficulty_level, options[]' })
    }

    // Revisão ortográfica (IA) - apenas escrita/acentos; preserva o conteúdo.
    let revisedQuestionText = String(question_text || '')
    let revisedOptions = options
    if (!skip_proofread) {
      try {
        const strings: string[] = [String(question_text || '')]
        for (const opt of options) {
          strings.push(String(opt?.option_text || ''))
          if (opt?.explanation) strings.push(String(opt.explanation || ''))
        }
        const { output } = await proofreadPtBrStrings({ strings })
        let cursor = 0
        revisedQuestionText = output[cursor++] ?? revisedQuestionText
        revisedOptions = options.map((opt: any) => {
          const option_text = output[cursor++] ?? String(opt?.option_text || '')
          let explanation = opt?.explanation
          if (opt?.explanation) {
            explanation = output[cursor++] ?? String(opt.explanation || '')
          }
          return { ...opt, option_text, explanation }
        })
      } catch {
        // ignore
      }
    }

    const dl = String(difficulty_level) as keyof typeof XP_BY_LEVEL
    const xp = XP_BY_LEVEL[dl]
    if (!xp) return res.status(400).json({ error: 'difficulty_level inválido' })

    // Ordenação estável: coloca a pergunta no final do quiz
    let nextOrderIndex = 0
    try {
      const { data: last } = await supabaseAdmin
        .from('quiz_questions')
        .select('order_index')
        .eq('challenge_id', challengeId)
        .order('order_index', { ascending: false })
        .limit(1)
      const max = Array.isArray(last) && last.length ? Number((last[0] as any)?.order_index) : NaN
      nextOrderIndex = (Number.isFinite(max) ? max : -1) + 1
    } catch {
      nextOrderIndex = 0
    }

    const { data: question, error: qErr } = await supabaseAdmin
      .from('quiz_questions')
      .insert({
        challenge_id: challengeId,
        question_text: revisedQuestionText,
        // OBS: precisa respeitar o CHECK do banco (basico/intermediario/avancado/especialista)
        difficulty_level: dl,
        xp_value: xp,
        order_index: nextOrderIndex,
        created_by: userId,
      })
      .select()
      .single()

    if (qErr) return res.status(400).json({ error: qErr.message })

    const toInsert = revisedOptions.map((opt: any) => ({
      question_id: question!.id,
      option_text: String(opt?.option_text || '').trim(),
      is_correct: !!opt?.is_correct,
      explanation: (opt?.explanation && String(opt.explanation).trim()) || null,
    }))

    // Embaralhar ordem das alternativas para evitar padrão fixo
    const shuffled = [...toInsert].sort(() => Math.random() - 0.5)

    const { error: oErr } = await supabaseAdmin.from('quiz_options').insert(shuffled)
    if (oErr) return res.status(400).json({ error: oErr.message })

    return res.status(200).json({ success: true, questionId: question!.id })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
