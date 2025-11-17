// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { question, correct, difficulty = 'basico', language = 'pt-BR', count = 4 } = req.body || {}
    if (!question || !correct) {
      return res.status(400).json({ error: 'Campos obrigatórios: question, correct' })
    }

    // Try OpenAI first, then fallback to simple heuristic generator
    const target = Math.max(1, Math.min(Number(count) || 4, 4))
    let wrong: Array<{ text: string; explanation?: string }> = []

    if (OPENAI_API_KEY) {
      try {
        const sys = `Você gera alternativas INCORRETAS plausíveis para perguntas de múltipla escolha em ${language}.\nRegras:\n- NUNCA repita a resposta correta; mantenha sentido e plausibilidade.\n- Texto curto (<= 120 caracteres), direto e específico.\n- Evite negações simples (“não …”), reordenação trivial ou sinônimos óbvios.\n- Use erros comuns, confusões de conceito, valores aproximados, ou condicionais ambíguas.\n- Adeque a dificuldade (básico/intermediário/avançado/especialista).\n- Sempre retorne apenas JSON válido no formato: {"items":[{"text":"...","explanation":"..."}]} (sem texto extra).`;
        const user = `Gere ${target} alternativas erradas.\nPergunta: ${question}\nResposta correta: ${correct}\nNível: ${difficulty}`
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: OPENAI_TEXT_MODEL,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: user },
            ],
            temperature: 0.7,
            max_tokens: 400,
          }),
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(txt)
        }
        const data = await resp.json()
        const content = data?.choices?.[0]?.message?.content || ''
        try {
          const parsed = JSON.parse(content)
          wrong = Array.isArray(parsed?.items) ? parsed.items : []
        } catch {
          // try to extract JSON from text
          const m = content.match(/\{[\s\S]*\}/)
          if (m) {
            const parsed = JSON.parse(m[0])
            wrong = Array.isArray(parsed?.items) ? parsed.items : []
          }
        }
      } catch (e) {
        // fallthrough to heuristic
      }
    }

    if (wrong.length < target) {
      // Heuristic fallback: create distractors by perturbing the correct answer
      const base = String(correct).trim()
      const variants = new Set<string>()
      const mut = (s: string) => s
        .replace(/\b(não|no|nao)\b/gi, '')
        .replace(/\d+/g, (m) => String(Number(m) + 1))
        .replace(/\b(é|são|sera|será)\b/gi, 'pode ser')
        .trim()
      const alt1 = mut(base)
      const alt2 = base.split(' ').reverse().join(' ')
      const alt3 = base.replace(/([aeiou])+/gi, '$1')
      ;[alt1, alt2, alt3].forEach((t) => {
        const txt = String(t).trim()
        if (txt && txt.toLowerCase() !== base.toLowerCase()) variants.add(txt)
      })
      wrong = Array.from(variants).slice(0, target).map((t) => ({ text: t, explanation: '' }))
    }

    // Sanitize and ensure 3 items
    const uniq: string[] = []
    const items = wrong
      .map((w) => ({ text: String(w.text || '').trim(), explanation: String(w.explanation || '').trim() }))
      .filter((w) => w.text && w.text.toLowerCase() !== String(correct).trim().toLowerCase())
      .filter((w) => {
        if (uniq.includes(w.text.toLowerCase())) return false
        uniq.push(w.text.toLowerCase())
        return true
      })
      .slice(0, target)

    if (items.length < target) {
      // pad with generic distractors
      const pads = ['Alternativa plausível A', 'Alternativa plausível B', 'Alternativa plausível C', 'Alternativa plausível D']
      while (items.length < target) items.push({ text: pads[items.length], explanation: '' })
    }

    return res.status(200).json({ wrong: items })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
