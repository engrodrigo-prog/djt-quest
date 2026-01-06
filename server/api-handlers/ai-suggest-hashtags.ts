import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const systemPrompt = `
Você é um assistente de hashtag PT-BR. Gere 5 hashtags curtas (sem espaços) baseadas no texto fornecido.
Regras:
- Só corrija ortografia da hashtag, não mude o sentido.
- Use no máximo 3 palavras por hashtag (separadas por underscore ou tudo junto).
- Prefira termos já citados no texto, campanhas ou temas técnicos.
- Responda apenas em JSON: {"hashtags": ["#tag1", "#tag2", ...]}.
`;

const STOPWORDS = new Set([
  'para',
  'com',
  'sem',
  'entre',
  'sobre',
  'quanto',
  'como',
  'quando',
  'onde',
  'porque',
  'por',
  'uma',
  'uns',
  'umas',
  'que',
  'não',
  'nao',
  'sim',
  'mais',
  'menos',
  'ser',
  'ter',
  'seu',
  'sua',
  'seus',
  'suas',
  'nos',
  'nas',
  'dos',
  'das',
  'aos',
  'as',
  'os',
  'ao',
  'de',
  'da',
  'do',
  'e',
  'o',
  'a',
]);

const normalizeToken = (raw: string) =>
  raw
    .toLowerCase()
    .normalize('NFD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const extractExistingHashtags = (text: string) => {
  const matches = Array.from(String(text || '').matchAll(/#([A-Za-z0-9_.-]+)/g)).map((m) => `#${m[1]}`);
  const uniq = Array.from(new Set(matches.map((t) => t.trim()).filter(Boolean)));
  return uniq.slice(0, 5);
};

const buildFallbackHashtags = (text: string) => {
  const existing = extractExistingHashtags(text);
  if (existing.length) return existing;

  const counts = new Map<string, number>();
  const tokens = String(text || '')
    .split(/\s+/)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length >= 4 && t.length <= 18 && !STOPWORDS.has(t));

  for (const t of tokens) {
    counts.set(t, (counts.get(t) || 0) + 1);
  }

  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => `#${t}`);

  if (top.length) return top;
  return ['#inovacao', '#seguranca', '#prontidao', '#time', '#execucao'];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    if (!client) {
      return res.status(200).json({ hashtags: buildFallbackHashtags(text), meta: { warning: 'OPENAI_API_KEY ausente' } });
    }
    const model = process.env.OPENAI_PREMIUM_MODEL || 'gpt-5.2-fast';
    const payload: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.slice(0, 6000) },
      ],
      response_format: { type: 'json_object' as any },
    };
    if (/^gpt-5/i.test(String(model))) payload.max_completion_tokens = 200;
    else payload.max_tokens = 200;
    const completion = await client.chat.completions.create(payload);

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
      return res.status(200).json({ hashtags: buildFallbackHashtags(text) });
    }

    return res.status(200).json({ hashtags });
  } catch (e: any) {
    console.error('ai-suggest-hashtags error', e);
    return res.status(200).json({ hashtags: buildFallbackHashtags(text), meta: { warning: e?.message || 'Falha ao sugerir hashtags' } });
  }
}
