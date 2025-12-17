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

export async function structureQuestionsWithAi(params) {
  const openaiKey = params?.openaiKey || process.env.OPENAI_API_KEY || '';
  const model = params?.model || process.env.MODEL || process.env.OPENAI_MODEL_PREMIUM || 'gpt-5.2';
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

export async function catalogIncidentReportWithAi(params) {
  const openaiKey = params?.openaiKey || process.env.OPENAI_API_KEY || '';
  const model = params?.model || process.env.MODEL || process.env.OPENAI_MODEL_PREMIUM || 'gpt-5.2';
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

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) },
      ],
      ...(String(model).startsWith('gpt-5') ? { max_completion_tokens: 1800 } : { max_tokens: 1800 }),
    }),
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) return { ok: false, error: json?.error?.message || `OpenAI error (${resp.status})` };

  const content = json?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Invalid AI response' };
  return { ok: true, model, catalog: parsed };
}

Regras:
- NÃO invente normas internas; se faltar informação, marque a pergunta como genérica e use explicação opcional.
- Alternativas devem ser objetivas e mutuamente exclusivas.
- Se não houver alt_e, omita ou deixe vazio.
- Retorne APENAS JSON válido.`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) },
      ],
      ...(String(model).startsWith('gpt-5') ? { max_completion_tokens: 2500 } : { max_tokens: 2500 }),
    }),
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) return { ok: false, error: json?.error?.message || `OpenAI error (${resp.status})` };

  const content = json?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : null;
  if (!questions) return { ok: false, error: 'Invalid AI response' };
  return { ok: true, model, questions };
}
