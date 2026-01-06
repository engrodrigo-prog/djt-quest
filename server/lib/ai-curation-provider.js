import { normalizeChatModel } from './openai-models.js';

const extractJson = (content) => {
  const s = String(content || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
};

const pickTextModel = (paramsModel) =>
  normalizeChatModel(
    paramsModel || process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_FAST || process.env.MODEL || 'gpt-5.2',
    'gpt-5.2',
  );

const pickVisionModel = (paramsModel) =>
  normalizeChatModel(
    paramsModel ||
      process.env.OPENAI_MODEL_VISION ||
      process.env.OPENAI_MODEL_PREMIUM ||
      process.env.OPENAI_MODEL_FAST ||
      'gpt-5.2',
    'gpt-5.2',
  );

async function callOpenAiChatJson({ openaiKey, model, system, user, maxTokens = 1800, temperature = 0.2 }) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(String(model).startsWith('gpt-5') ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    }),
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) return { ok: false, error: json?.error?.message || `OpenAI error (${resp.status})` };
  const content = json?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Invalid AI response' };
  return { ok: true, parsed };
}

export async function structureQuestionsWithAi(params) {
  const openaiKey = params?.openaiKey || process.env.OPENAI_API_KEY || '';
  const model = pickTextModel(params?.model);
  const input = params?.input;
  if (!openaiKey) return { ok: false, error: 'OPENAI_API_KEY not configured' };
  if (!input) return { ok: false, error: 'Missing input' };

  const system = `Você é um curador de conteúdo de quizzes.
Converta o material bruto em uma lista JSON de questões.

Formato de saída obrigatório (JSON puro):
{
  "questions": [
    {
      "pergunta": "string",
      "alt_a": "string",
      "alt_b": "string",
      "alt_c": "string",
      "alt_d": "string",
      "alt_e": "string (opcional)",
      "correta": "A|B|C|D|E",
      "explicacao": "string (opcional)"
    }
  ]
}

Regras:
- NÃO invente normas internas; se faltar informação, marque a pergunta como genérica e use explicação opcional.
- Alternativas devem ser objetivas e mutuamente exclusivas.
- Se não houver alt_e, omita ou deixe vazio.
- Retorne APENAS JSON válido.`;

  const user = typeof input === 'string' ? input : JSON.stringify(input);
  const out = await callOpenAiChatJson({ openaiKey, model, system, user, maxTokens: 2500, temperature: 0.2 });
  if (!out.ok) return out;
  const questions = Array.isArray(out.parsed?.questions) ? out.parsed.questions : null;
  if (!questions) return { ok: false, error: 'Invalid AI response' };
  return { ok: true, model, questions };
}

export async function catalogIncidentReportWithAi(params) {
  const openaiKey = params?.openaiKey || process.env.OPENAI_API_KEY || '';
  const model = pickTextModel(params?.model);
  const input = params?.input;
  if (!openaiKey) return { ok: false, error: 'OPENAI_API_KEY not configured' };
  if (!input) return { ok: false, error: 'Missing input' };

  const system = `Você é um especialista em confiabilidade e operação de sistemas elétricos (subestações, telecom e linhas).
Seu trabalho é catalogar relatórios de ocorrência e extrair aprendizados SEM inventar dados.

Formato de saída obrigatório (JSON puro):
{
  "title": "string",
  "summary": "string",
  "asset_area": "subestacao|telecom|linhas|geral|desconhecido",
  "asset_type": "string (ex.: disjuntor, relé, rádio, OPGW, etc.)",
  "asset_subtype": "string (opcional)",
  "failure_mode": "string (modo de falha observado)",
  "root_cause": "string (causa raiz provável ou confirmada; se não houver, use 'não informado')",
  "severity": "baixa|media|alta|critica|desconhecida",
  "keywords": ["string"],
  "learning_points": ["string"],
  "suggested_forum_prompts": ["string"],
  "suggested_quiz_topics": ["string"]
}

Regras:
- Se algum campo não puder ser inferido com segurança, use "desconhecido" / "não informado".
- Seja conciso: summary em 3 a 6 frases.
- keywords: 5 a 12 itens.
- learning_points: 3 a 8 itens práticos.
- Retorne APENAS JSON válido.`;

  const user = typeof input === 'string' ? input : JSON.stringify(input);
  const out = await callOpenAiChatJson({ openaiKey, model, system, user, maxTokens: 1800, temperature: 0.2 });
  if (!out.ok) return out;
  return { ok: true, model, catalog: out.parsed };
}

export async function extractImageTextWithAi(params) {
  const openaiKey = params?.openaiKey || process.env.OPENAI_API_KEY || '';
  const model = pickVisionModel(params?.model);
  const buffer = params?.buffer;
  const mime = String(params?.mime || 'image/jpeg');
  const hint = params?.hint != null ? String(params.hint) : '';
  if (!openaiKey) return { ok: false, error: 'OPENAI_API_KEY not configured' };
  if (!buffer || !Buffer.isBuffer(buffer)) return { ok: false, error: 'Missing image buffer' };
  if (!mime.startsWith('image/')) return { ok: false, error: `Unsupported image mime: ${mime}` };

  const MAX_BYTES = 6 * 1024 * 1024; // evita payloads enormes em serverless
  if (buffer.length > MAX_BYTES) {
    return { ok: false, error: 'Imagem muito grande para OCR (reduza para até ~6MB ou envie em partes).' };
  }

  const system = `Você faz OCR e descreve imagens no contexto de treinamento técnico (setor elétrico).
Extraia todo texto legível (placas, tabelas, prints, diagramas) e descreva o que a imagem mostra, sem inventar.

Responda APENAS em JSON válido no formato:
{
  "text": "texto extraído (pode ser vazio)",
  "description": "descrição curta do que aparece na imagem (1-3 frases)"
}`;

  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Extraia o texto e descreva a imagem.\n' +
                (hint ? `\nContexto (opcional): ${hint}\n` : ''),
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      ...(String(model).startsWith('gpt-5') ? { max_completion_tokens: 900 } : { max_tokens: 900 }),
    }),
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) return { ok: false, error: json?.error?.message || `OpenAI error (${resp.status})` };

  const content = json?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Invalid AI response' };

  const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  const description = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
  return { ok: true, model, text, description };
}
