// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { loadLocalEnvIfNeeded } from '../lib/load-local-env.js';
import { normalizeChatModel } from '../lib/openai-models.js';

loadLocalEnvIfNeeded();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
// Fast model for orthography/cleanup tasks (fallback chain keeps compatibility).
const OPENAI_TEXT_MODEL = normalizeChatModel(
  process.env.OPENAI_MODEL_FAST ||
    process.env.OPENAI_TEXT_MODEL ||
    process.env.OPENAI_MODEL_OVERRIDE ||
    'gpt-5-2025-08-07',
  'gpt-5-2025-08-07',
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Mantemos cópias seguras para fallback em qualquer erro
  let safeTitle = '[sem título]';
  let safeDescription = '';
  let language = 'pt-BR';

  try {
    const body = (req.body || {}) as any;
    const rawTitle = body.title;
    const rawDescription = body.description;
    language = typeof body.language === 'string' && body.language.trim() ? body.language : 'pt-BR';

    safeTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : '[sem título]';
    if (!rawDescription || typeof rawDescription !== 'string') {
      return res.status(400).json({ error: 'description obrigatório' });
    }
    safeDescription = rawDescription;

    if (!OPENAI_API_KEY) {
      return res.status(200).json({
        cleaned: { title: safeTitle.trim(), description: safeDescription.trim() },
        meta: { usedAI: false, reason: 'missing_api_key' },
      });
    }

    const system = `Você é um REVISOR GRAMATICAL em ${language} para textos corporativos.
REGRAS OBRIGATÓRIAS (NÃO QUEBRE):
- NÃO reescreva frases, NÃO resuma, NÃO aumente e NÃO mude o sentido das frases.
- NÃO troque palavras por sinônimos, NÃO mude tempos verbais e NÃO reorganize a ordem das frases.
- NÃO altere números, medidas, nomes de pessoas, empresas, equipamentos ou normas.
- Apenas:
  • corrija erros de ortografia (acentos, letras trocadas);
  • corrija pontuação (vírgulas, pontos, parágrafos);
  • corrija concordância gramatical simples, mantendo exatamente a mesma mensagem.
- Preserve o estilo, o vocabulário técnico e o comprimento aproximado do texto original.
- Nunca adicione informações novas nem remova informações existentes.
Saída: responda SOMENTE em JSON válido, no formato exato:
{"title":"...","description":"..."}`;

    const user = `Título original:
"""${safeTitle}"""

Descrição original:
"""${safeDescription}"""`;

    const body: any = {
      model: OPENAI_TEXT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    };
    if (/^gpt-5/i.test(String(OPENAI_TEXT_MODEL))) body.max_completion_tokens = 400;
    else body.max_tokens = 400;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return res.status(200).json({
        cleaned: { title: safeTitle.trim(), description: safeDescription.trim() },
        meta: { usedAI: false, reason: `openai_error: ${txt || resp.status}` },
      });
    }

    const data = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content || '';
    let json: any;
    try {
      json = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) json = JSON.parse(m[0]);
    }

    if (!json?.title || !json?.description) {
      return res.status(200).json({
        cleaned: { title: safeTitle.trim(), description: safeDescription.trim() },
        meta: { usedAI: false, reason: 'bad_ai_format' },
      });
    }

    return res.status(200).json({
      cleaned: {
        title: String(json.title || safeTitle).trim(),
        description: String(json.description || safeDescription).trim(),
      },
      meta: { usedAI: true },
    });
  } catch (err: any) {
    return res.status(200).json({
      cleaned: {
        title: safeTitle.trim(),
        description: safeDescription.trim(),
      },
      meta: { usedAI: false, reason: err?.message || 'unknown' },
    });
  }
}

export const config = { api: { bodyParser: true } };
