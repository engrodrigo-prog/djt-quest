// @ts-nocheck
import { normalizeChatModel } from './openai-models.js';
type ProofreadResult = { output: string[]; usedModel?: string };

const stripDiacritics = (s: string) =>
  s
    .normalize('NFD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, '');

const baseNormalize = (s: string) =>
  stripDiacritics(String(s ?? ''))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const levenshtein = (a: string, b: string) => {
  const s = a || '';
  const t = b || '';
  if (s === t) return 0;
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const prev = new Array(m + 1);
  const curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    const sc = s.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = sc === t.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= m; j++) prev[j] = curr[j];
  }
  return prev[m];
};

const isSafeOrthographicCorrection = (input: string, output: string) => {
  const inS = String(input ?? '');
  const outS = String(output ?? '');
  if (!inS.trim() && !outS.trim()) return true;
  if (inS.trim() && !outS.trim()) return false;
  if (inS === outS) return true;

  const inN = baseNormalize(inS);
  const outN = baseNormalize(outS);
  if (inN === outN) return true;

  const dist = levenshtein(inN, outN);
  const maxLen = Math.max(inN.length, outN.length);
  const allowed = Math.min(8, Math.max(2, Math.ceil(maxLen * 0.08)));
  const lengthOk = Math.abs(inS.length - outS.length) <= Math.ceil(inS.length * 0.25) + 4;
  return dist <= allowed && lengthOk;
};

const extractJson = (content: string) => {
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

export async function proofreadPtBrStrings(params: {
  openaiKey?: string;
  strings: string[];
  model?: string;
}): Promise<ProofreadResult> {
  const openaiKey = params.openaiKey || process.env.OPENAI_API_KEY || '';
  const inputStrings = (params.strings || []).map((s) => String(s ?? ''));
  if (!openaiKey) return { output: inputStrings };
  if (!inputStrings.length) return { output: inputStrings };

  const totalChars = inputStrings.reduce((sum, s) => sum + s.length, 0);
  if (totalChars > 24_000 || inputStrings.length > 80) {
    return { output: inputStrings };
  }

  const model = normalizeChatModel(
    params.model ||
      process.env.OPENAI_MODEL_FAST ||
      process.env.OPENAI_TEXT_MODEL ||
      process.env.OPENAI_MODEL_PREMIUM ||
      'gpt-5.2-fast',
    'gpt-5.2-fast',
  );

  const system = `Você é um revisor ortográfico em PT-BR.
Sua tarefa: corrigir APENAS ortografia, acentuação, concordância nominal/verbal mínima e pontuação básica.
Regras rígidas:
- NÃO reescreva frases, NÃO mude o sentido, NÃO simplifique, NÃO resuma.
- NÃO altere termos técnicos, siglas (ex.: CPFL, SEP, NR-10), códigos, números, unidades, nomes próprios ou formatação técnica.
- Se houver dúvida, devolva o texto exatamente como entrou.
Retorne APENAS JSON válido: {"strings": ["...","..."]} mantendo o mesmo número de itens.`;

  const user = {
    role: 'user',
    content: JSON.stringify({ strings: inputStrings }),
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: 'system', content: system }, user],
    }),
  });

  const json = await resp.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content;
  const parsed = extractJson(content || '');
  const out = Array.isArray(parsed?.strings) ? parsed.strings.map((s: any) => String(s ?? '')) : null;
  if (!out || out.length !== inputStrings.length) return { output: inputStrings, usedModel: model };

  const safe = inputStrings.map((orig, idx) => {
    const candidate = out[idx] ?? orig;
    return isSafeOrthographicCorrection(orig, candidate) ? candidate : orig;
  });

  return { output: safe, usedModel: model };
}
