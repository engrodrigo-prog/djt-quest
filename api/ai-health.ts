import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string | undefined

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, stage: 'env', error: 'Missing OPENAI_API_KEY' })
    }

    const tryModels = Array.from(new Set([
      process.env.OPENAI_MODEL_FAST,
      process.env.OPENAI_MODEL_PREMIUM,
      process.env.OPENAI_MODEL_OVERRIDE,
      'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o', 'gpt-5', 'gpt-4.1', 'gpt-3.5-turbo'
    ].filter(Boolean)))
    let lastErrorText = ''
    let usedModel: string | null = null
    let latency_ms = 0

    for (const model of tryModels) {
      const start = Date.now()
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 10,
          messages: [
            { role: 'system', content: 'Você é um verificador de saúde. Responda somente com {"ok":true}.' },
            { role: 'user', content: 'ping' },
          ],
        }),
      })
      latency_ms = Date.now() - start

      if (!resp.ok) {
        lastErrorText = (await resp.text().catch(() => '')) || `HTTP ${resp.status}`
        continue
      }
      const data = await resp.json().catch(() => ({}))
      const content: string | null = data?.choices?.[0]?.message?.content || null
      let parsed: any = null
      try { parsed = content ? JSON.parse(content) : null } catch { /* ignore */ }
      // Also accept plain text that contains ok:true
      const textOk = typeof content === 'string' && /"ok"\s*:\s*true/.test(content)
      if ((parsed && parsed.ok === true) || textOk) {
        usedModel = model
        return res.status(200).json({ ok: true, latency_ms, model: usedModel, ts: new Date().toISOString() })
      } else {
        lastErrorText = 'Unexpected model output'
      }
    }

    return res.status(400).json({ ok: false, stage: 'openai', error: lastErrorText || 'All model attempts failed', tried: tryModels })
  } catch (e: any) {
    return res.status(500).json({ ok: false, stage: 'handler', error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: false } }
