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

