// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'

import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js'
import { rolesToSet, canAccessStudio } from '../lib/rbac.js'
import { normalizeChatModel } from '../lib/openai-models.js'
import { parseJsonFromAiContent } from '../lib/ai-curation-provider.js'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_PARSE_MODEL = normalizeChatModel(
  process.env.OPENAI_QUIZ_PARSE_MODEL ||
    process.env.OPENAI_MODEL_PREMIUM ||
    process.env.OPENAI_TEXT_MODEL ||
    process.env.OPENAI_MODEL_FAST ||
    process.env.OPENAI_MODEL_OVERRIDE ||
    'gpt-5-2025-08-07',
  'gpt-5-2025-08-07',
)

const clampQuestions = (raw: any) => {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 30
  return Math.max(1, Math.min(Math.floor(n), 50))
}

const isDifficulty = (v: any) => ['basico', 'intermediario', 'avancado', 'especialista'].includes(String(v || '').trim())

const normalizeLetter = (raw: any) => {
  const s = String(raw || '').trim().toUpperCase()
  if (s === 'A' || s === 'B' || s === 'C' || s === 'D') return s
  return null
}

const heuristicParse = (text: any) => {
  const raw = String(text || '').replace(/\r\n/g, '\n')
  const blocks = raw
    .split(/\n(?=(?:\s*(?:Q(?:uest[aã]o)?\s*\d+|Pergunta\s*\d+)\s*[:.)]))/i)
    .map((b) => b.trim())
    .filter(Boolean)

  /** @type {any[]} */
  const out: any[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue

    const optionRe = /^([A-D])\s*[\)\.\-:]\s*(.+)$/i
    const options: Array<{ letter: string; text: string }> = []
    let questionLines: string[] = []
    for (const line of lines) {
      const m = line.match(optionRe)
      if (m) options.push({ letter: m[1].toUpperCase(), text: String(m[2] || '').trim() })
      else if (!/^correta\b|^resposta\b/i.test(line)) questionLines.push(line)
    }
    const qText = questionLines
      .join(' ')
      .replace(/^(Q(?:uest[aã]o)?|Pergunta)\s*\d+\s*[:.)]\s*/i, '')
      .trim()

    const correctLine = lines.find((l) => /^correta\b|^resposta\b/i.test(l)) || ''
    const correctLetter = normalizeLetter((correctLine.match(/\b([A-D])\b/i) || [])[1])

    if (qText.length < 10) continue
    if (options.length < 2) continue
    if (!correctLetter) continue
    const byLetter = new Map(options.map((o) => [o.letter, o.text]))
    const ordered = ['A', 'B', 'C', 'D'].map((L) => ({
      text: String(byLetter.get(L) || '').trim(),
      is_correct: L === correctLetter,
      explanation: '',
    }))
    if (ordered.some((o) => !o.text)) continue
    out.push({ question_text: qText, options: ordered, difficulty_level: 'intermediario' })
  }
  return out
}

const sanitizeQuestions = ({ questions, defaultDifficulty = 'intermediario' }: any) => {
  const issues: string[] = []
  const cleaned: any[] = []

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i] || {}
    const question_text = String(q.question_text || q.question || q.pergunta || '').trim()
    if (question_text.length < 10) {
      issues.push(`Q${i + 1}: pergunta curta/ausente`)
      continue
    }

    const difficulty_level = isDifficulty(q.difficulty_level) ? q.difficulty_level : defaultDifficulty

    const optsRaw = Array.isArray(q.options) ? q.options : Array.isArray(q.alternatives) ? q.alternatives : null

    let options: any[] = []
    if (optsRaw) {
      options = optsRaw.map((o: any) => ({
        text: String(o?.text || o?.option_text || '').trim(),
        is_correct: Boolean(o?.is_correct),
        explanation: String(o?.explanation || '').trim(),
      }))
    } else {
      const corr = normalizeLetter(q.correta || q.correct_letter || q.correct || '')
      const alt = [
        { L: 'A', text: String(q.alt_a || '').trim() },
        { L: 'B', text: String(q.alt_b || '').trim() },
        { L: 'C', text: String(q.alt_c || '').trim() },
        { L: 'D', text: String(q.alt_d || '').trim() },
      ]
      if (alt.every((a) => a.text)) {
        options = alt.map((a) => ({
          text: a.text,
          is_correct: Boolean(corr && a.L === corr),
          explanation: String(q.explicacao || q.explanation || '').trim(),
        }))
      }
    }

    options = options
      .map((o) => ({ ...o, text: String(o.text || '').trim() }))
      .filter((o) => o.text.length > 0)
      .slice(0, 4)

    if (options.length !== 4) {
      issues.push(`Q${i + 1}: precisa de 4 alternativas (encontrei ${options.length})`)
      continue
    }

    const correctCount = options.filter((o) => o.is_correct).length
    if (correctCount !== 1) {
      issues.push(`Q${i + 1}: precisa de exatamente 1 alternativa correta (encontrei ${correctCount})`)
      continue
    }

    const seen = new Set<string>()
    const norm = (s: any) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    let dup = false
    for (const o of options) {
      const k = norm(o.text)
      if (seen.has(k)) {
        dup = true
        break
      }
      seen.add(k)
    }
    if (dup) {
      issues.push(`Q${i + 1}: alternativas duplicadas`)
      continue
    }

    cleaned.push({ question_text, difficulty_level, options })
  }

  return { cleaned, issues }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { text, language = 'pt-BR', maxQuestions = 30, defaultDifficulty = 'intermediario' } = (req.body || {}) as any
    const inputText = String(text || '').trim()
    if (!inputText) return res.status(400).json({ error: 'Campo obrigatório: text' })

    const supabaseAdmin = createSupabaseAdminClient()
    const caller = await requireCallerUser(supabaseAdmin, req)
    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      supabaseAdmin.from('user_roles').select('role').eq('user_id', caller.id),
      supabaseAdmin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ])
    const roleSet = rolesToSet(rolesRows)
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' })

    const limit = clampQuestions(maxQuestions)

    let parsed: any = null
    let usedAi = false

    if (OPENAI_API_KEY) {
      try {
        const model = OPENAI_PARSE_MODEL
        const isGpt5 = /^gpt-5/i.test(String(model))
        const system = `Você converte texto livre em um conjunto de perguntas de múltipla escolha.
Saída obrigatória: APENAS JSON válido.

Retorne exatamente neste formato:
{
  "questions": [
    {
      "question_text": "string",
      "difficulty_level": "basico|intermediario|avancado|especialista",
      "options": [
        { "text": "string", "is_correct": true, "explanation": "string" },
        { "text": "string", "is_correct": false, "explanation": "string" },
        { "text": "string", "is_correct": false, "explanation": "string" },
        { "text": "string", "is_correct": false, "explanation": "string" }
      ]
    }
  ]
}

Regras:
- Idioma: ${language}.
- Cada pergunta deve ter exatamente 4 alternativas e exatamente 1 correta.
- Se o texto do usuário não trouxer 3 erradas, gere erradas verossímeis e factíveis (mas ERRADAS).
- Se o texto marcar a correta (ex.: "Correta: B", "*" na alternativa, "(correta)"), preserve essa correta; não invente outra.
- Explicação: 1 a 3 frases, direta, sem inventar normas internas; se não houver, use "".
- Evite "todas/nenhuma das alternativas" e não repita a correta nas erradas.
- Retorne no máximo ${limit} perguntas.`

        const user = inputText.slice(0, 24000)
        const body: any = {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }
        if (isGpt5) body.max_completion_tokens = 2600
        else {
          body.max_tokens = 2600
          body.temperature = 0.2
        }

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json: any = await resp.json().catch(() => null)
        if (!resp.ok) throw new Error(json?.error?.message || `OpenAI error (${resp.status})`)
        const content = json?.choices?.[0]?.message?.content || ''
        parsed = parseJsonFromAiContent(content).parsed
        if (parsed && typeof parsed === 'object') usedAi = true
      } catch {
        parsed = null
      }
    }

    const questionsRaw = Array.isArray(parsed?.questions) ? parsed.questions : heuristicParse(inputText)
    const { cleaned, issues } = sanitizeQuestions({ questions: questionsRaw, defaultDifficulty })

    if (!cleaned.length) {
      return res.status(400).json({
        error: 'Não foi possível extrair perguntas do texto. Verifique se há alternativas A-D e indicação da correta (ex.: "Correta: B").',
        details: { issues: issues.slice(0, 30) },
        meta: { usedAi },
      })
    }

    return res.status(200).json({
      success: true,
      questions: cleaned.slice(0, limit),
      issues: issues.slice(0, 50),
      meta: { usedAi, model: usedAi ? OPENAI_PARSE_MODEL : null, limit },
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: { sizeLimit: '1mb' } }, maxDuration: 60 }

