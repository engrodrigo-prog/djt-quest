import { normalizeChatModel } from './openai-models.js';

const tryParseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const stripBOM = (s) => (s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const removeTrailingCommas = (s) => String(s || '').replace(/,\s*([}\]])/g, '$1');

const extractFirstJsonValue = (raw) => {
  const s = String(raw || '');
  let start = -1;
  const stack = [];
  let inString = false;
  let escape = false;
  let quoteChar = '"';

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      continue;
    }

    if (start === -1) {
      if (ch === '{' || ch === '[') {
        start = i;
        stack.push(ch === '{' ? '}' : ']');
      }
      continue;
    }

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (stack.length && ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return s.slice(start, i + 1);
    }
  }

  return null;
};

export const parseJsonFromAiContent = (content) => {
  const raw = String(content || '');
  const trimmed = stripBOM(raw.trim());
  if (!trimmed) return { parsed: null, candidate: null };

  // 1) Direct JSON
  const direct = tryParseJson(trimmed);
  if (direct && typeof direct === 'object') return { parsed: direct, candidate: trimmed };

  // 2) Code fences (```json ... ```)
  const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  for (const match of trimmed.matchAll(fenceRe)) {
    const block = stripBOM(removeTrailingCommas(String(match?.[1] || '').trim()));
    const parsed = tryParseJson(block);
    if (parsed && typeof parsed === 'object') return { parsed, candidate: block };
  }

  // 3) First balanced JSON object/array inside the text
  const extracted = extractFirstJsonValue(trimmed) || extractFirstJsonValue(raw);
  if (extracted) {
    const cleaned = stripBOM(removeTrailingCommas(extracted.trim()));
    const parsed = tryParseJson(cleaned);
    if (parsed && typeof parsed === 'object') return { parsed, candidate: cleaned };
  }

  return { parsed: null, candidate: extracted || null };
};

const pickTextModel = (paramsModel) =>
  normalizeChatModel(
    paramsModel || process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_FAST || process.env.MODEL || 'gpt-5-2025-08-07',
    'gpt-5-2025-08-07',
  );

const pickVisionModel = (paramsModel) =>
  normalizeChatModel(
    paramsModel ||
      process.env.OPENAI_MODEL_VISION ||
      process.env.OPENAI_MODEL_PREMIUM ||
      process.env.OPENAI_MODEL_FAST ||
      'gpt-5-2025-08-07',
    'gpt-5-2025-08-07',
  );

async function callOpenAiChatJson({ openaiKey, model, system, user, maxTokens = 1800, temperature = 0.2 }) {
  const isGpt5 = String(model).startsWith('gpt-5');
  const doCall = async ({ sys, usr, max }) => {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model,
        ...(isGpt5 ? {} : { temperature }),
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: usr },
        ],
        ...(isGpt5 ? { max_completion_tokens: max } : { max_tokens: max }),
      }),
    });
    const json = await resp.json().catch(() => null);
    return { resp, json };
  };

  const { resp, json } = await doCall({ sys: system, usr: user, max: maxTokens });

  if (!resp.ok) return { ok: false, error: json?.error?.message || `OpenAI error (${resp.status})` };
  const content = json?.choices?.[0]?.message?.content || '';
  let { parsed } = parseJsonFromAiContent(content);

  // Fallback: ask the model to repair its own output into valid JSON.
  if (!parsed || typeof parsed !== 'object') {
    const repairSystem = `Você corrige respostas malformadas e devolve APENAS um JSON válido seguindo o mesmo esquema esperado.
Não inclua comentários, texto extra, Markdown, nem blocos de código.`;
    const repairUser = String(content || '').slice(0, 6000);
    const repair = await doCall({ sys: repairSystem, usr: repairUser, max: Math.min(1200, maxTokens) });
    if (repair.resp.ok) {
      const repairContent = repair.json?.choices?.[0]?.message?.content || '';
      parsed = parseJsonFromAiContent(repairContent).parsed;
    }
  }

  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Invalid AI response (JSON)' };
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
  const hints = params?.hints != null ? String(params.hints) : '';
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

  const base = typeof input === 'string' ? input : JSON.stringify(input);
  const user = [hints ? `### Contexto do item\n${hints}\n` : '', base].filter(Boolean).join('\n\n');
  const out = await callOpenAiChatJson({ openaiKey, model, system, user, maxTokens: 1800, temperature: 0.2 });
  if (!out.ok) return out;
  return { ok: true, model, catalog: out.parsed };
}

export async function catalogStudyMaterialWithAi(params) {
  const openaiKey = params?.openaiKey || process.env.OPENAI_API_KEY || '';
  const model = pickTextModel(params?.model);
  const input = params?.input;
  const hints = params?.hints != null ? String(params.hints) : '';
  if (!openaiKey) return { ok: false, error: 'OPENAI_API_KEY not configured' };
  if (!input) return { ok: false, error: 'Missing input' };

  const system = `Você é um bibliotecário técnico.
Seu trabalho é catalogar MATERIAIS de estudo (manuais, procedimentos, guias) e extrair um resumo pesquisável SEM inventar dados.

Formato de saída obrigatório (JSON puro):
{
  "title": "string",
  "summary": "string",
  "document_type": "manual|procedimento|guia|apresentacao|norma|outro|desconhecido",
  "topic_area": "string (ex.: drones, segurança, manutenção, telecom, linhas, subestação, etc.)",
  "audience_level": "iniciante|intermediario|avancado|desconhecido",
  "tags": ["string"],
  "key_points": ["string"],
  "suggested_quiz_topics": ["string"],
  "suggested_forum_prompts": ["string"]
}

Regras:
- Se algum campo não puder ser inferido com segurança, use "desconhecido" / "outro".
- title: curto e humano (6 a 14 palavras). Não use códigos internos (ex.: GED, IDs, hashes).
- summary: 3 a 6 frases, em português, dizendo o que o material cobre e como usar.
- tags: 5 a 12 termos curtos (sem #).
- key_points: 4 a 10 itens práticos.
- Retorne APENAS JSON válido.`;

  const base = typeof input === 'string' ? input : JSON.stringify(input);
  const user = [hints ? `### Contexto do item\n${hints}\n` : '', base].filter(Boolean).join('\n\n');
  const out = await callOpenAiChatJson({ openaiKey, model, system, user, maxTokens: 1400, temperature: 0.2 });
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
  const parsed = parseJsonFromAiContent(content).parsed;
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Invalid AI response (JSON)' };

  const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  const description = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
  return { ok: true, model, text, description };
}
