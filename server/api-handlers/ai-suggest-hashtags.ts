import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const systemPrompt = `
Você é um assistente de hashtag PT-BR. Gere 5 hashtags curtas (sem espaços) baseadas no texto fornecido.
Regras:
- Só corrija ortografia da hashtag, não mude o sentido.
- Use no máximo 3 palavras por hashtag (separadas por underscore ou tudo junto).
- Prefira termos já citados no texto, campanhas ou temas técnicos.
- Responda apenas em JSON: {"hashtags": ["#tag1", "#tag2", ...]}.
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_PREMIUM_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.slice(0, 6000) },
      ],
      max_tokens: 200,
      response_format: { type: 'json_object' as any },
    });

    const raw =
      completion.choices[0]?.message?.content &&
      (Array.isArray(completion.choices[0].message.content)
        ? (completion.choices[0].message.content[0] as any).text
        : completion.choices[0].message.content);
    let hashtags: string[] = [];
    try {
      const parsed = JSON.parse(raw || '{}');
      if (Array.isArray(parsed.hashtags)) {
        hashtags = parsed.hashtags
          .map((s: any) => String(s || '').trim())
          .filter((s: string) => s.startsWith('#') && s.length >= 2)
          .slice(0, 5);
      }
    } catch {}

    if (hashtags.length === 0) {
      return res.status(200).json({ hashtags: ['#inovacao', '#seguranca', '#prontidao', '#time', '#execucao'] });
    }

    return res.status(200).json({ hashtags });
  } catch (e: any) {
    console.error('ai-suggest-hashtags error', e);
    return res.status(500).json({ error: e?.message || 'Falha ao sugerir hashtags' });
  }
}
