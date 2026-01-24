// @ts-nocheck
import { normalizeChatModel } from './openai-models.js';
const stripDiacritics = (s) =>
  String(s ?? '')
    .normalize('NFD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, '');

const baseNormalize = (s) =>
  stripDiacritics(String(s ?? ''))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const levenshtein = (a, b) => {
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
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= m; j++) prev[j] = curr[j];
  }
  return prev[m];
};

const isSafeOrthographicCorrection = (input, output) => {
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

const collectCriticalTokens = (s) => {
  const text = String(s ?? '');
  const acronyms = Array.from(text.matchAll(/\b[A-Z]{2,}(?:-[A-Z0-9]{1,})*\b/g)).map((m) => m[0]);
  const numbers = Array.from(text.matchAll(/\b\d+(?:[.,]\d+)?\b/g)).map((m) => m[0]);
  const unique = (arr) => Array.from(new Set(arr.filter(Boolean)));
  return { acronyms: unique(acronyms), numbers: unique(numbers) };
};

const preservesCriticalTokens = (input, output) => {
  const a = collectCriticalTokens(input);
  const out = String(output ?? '');
  // Preserve acronyms/siglas and numbers (avoid changing meaning of NR-10, 13.8kV, etc).
  for (const tok of a.acronyms) {
    if (!out.includes(tok)) return false;
  }
  for (const tok of a.numbers) {
    if (!out.includes(tok)) return false;
  }
  return true;
};

const isSafePolish = (input, output) => {
  const inS = String(input ?? '');
  const outS = String(output ?? '');
  if (!inS.trim() && !outS.trim()) return true;
  if (inS.trim() && !outS.trim()) return false;
  if (inS === outS) return true;

  const inN = baseNormalize(inS);
  const outN = baseNormalize(outS);
  if (!inN && !outN) return true;
  if (inN && !outN) return false;
  if (inN === outN) return preservesCriticalTokens(inS, outS);

  const dist = levenshtein(inN, outN);
  const maxLen = Math.max(inN.length, outN.length);
  const allowed = Math.min(36, Math.max(6, Math.ceil(maxLen * 0.22)));
  const lengthOk = Math.abs(inS.length - outS.length) <= Math.ceil(inS.length * 0.6) + 12;
  return dist <= allowed && lengthOk && preservesCriticalTokens(inS, outS);
};

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
const collectOutputText = (payload) => {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = output.map((item) => {
    if (typeof item?.content === "string") return item.content;
    if (Array.isArray(item?.content)) {
      return item.content.map((c) => c?.text || c?.content || "").join("\n");
    }
    return item?.text || "";
  }).filter(Boolean);
  return chunks.join("\n").trim();
};

export async function proofreadPtBrStrings(params) {
  const openaiKey = params?.openaiKey || process.env.OPENAI_API_KEY || '';
  const inputStrings = (params?.strings || []).map((s) => String(s ?? ''));
  if (!openaiKey) return { output: inputStrings };
  if (!inputStrings.length) return { output: inputStrings };

  const totalChars = inputStrings.reduce((sum, s) => sum + s.length, 0);
  if (totalChars > 24_000 || inputStrings.length > 80) {
    return { output: inputStrings };
  }

  const model = normalizeChatModel(
    params?.model ||
      process.env.OPENAI_MODEL_FAST ||
      process.env.OPENAI_TEXT_MODEL ||
      process.env.OPENAI_MODEL_PREMIUM ||
      'gpt-5-2025-08-07',
    'gpt-5-2025-08-07',
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

  const useResponses = /^gpt-5/i.test(String(model));
  let content = "";

  if (useResponses) {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model,
	        input: [
	          { role: "system", content: [{ type: "input_text", text: system }] },
	          { role: "user", content: [{ type: "input_text", text: user.content }] }
	        ],
	        text: { verbosity: "low" },
	        max_output_tokens: 1200
	      })
	    });
    if (!resp.ok) return { output: inputStrings };
    const json = await resp.json().catch(() => null);
    content = collectOutputText(json) || "";
  } else {
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        user
      ]
    };
    if (/^gpt-5/i.test(String(model))) body.max_completion_tokens = 1800;
    else body.max_tokens = 1800;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) return { output: inputStrings };
    const json = await resp.json().catch(() => null);
    content = json?.choices?.[0]?.message?.content || "";
  }
  const parsed = extractJson(content || '');
  const out = Array.isArray(parsed?.strings) ? parsed.strings.map((s) => String(s ?? '')) : null;
  if (!out || out.length !== inputStrings.length) return { output: inputStrings, usedModel: model };

  const safe = inputStrings.map((orig, idx) => {
    const candidate = out[idx] ?? orig;
    return isSafeOrthographicCorrection(orig, candidate) ? candidate : orig;
  });

  return { output: safe, usedModel: model };
}

export async function polishPtBrStrings(params) {
  const openaiKey = params?.openaiKey || process.env.OPENAI_API_KEY || '';
  const inputStrings = (params?.strings || []).map((s) => String(s ?? ''));
  if (!openaiKey) return { output: inputStrings };
  if (!inputStrings.length) return { output: inputStrings };

  const totalChars = inputStrings.reduce((sum, s) => sum + s.length, 0);
  if (totalChars > 18_000 || inputStrings.length > 40) {
    return { output: inputStrings };
  }

  const model = normalizeChatModel(
    params?.model ||
      process.env.OPENAI_MODEL_FAST ||
      process.env.OPENAI_TEXT_MODEL ||
      process.env.OPENAI_MODEL_PREMIUM ||
      'gpt-5-2025-08-07',
    'gpt-5-2025-08-07',
  );

  const system = `Você é um revisor de texto em PT-BR focado em feedback profissional.
Sua tarefa:
- Corrigir ortografia, acentuação e pontuação.
- Melhorar levemente clareza e objetividade (reorganizar frases, remover repetição, ajustar conectivos).
Regras rígidas:
- NÃO mude o sentido, NÃO adicione fatos, NÃO invente detalhes, NÃO inclua elogios/genéricos extras.
- Preserve termos técnicos, siglas (ex.: CPFL, SEP, NR-10), códigos, números, unidades e nomes próprios.
- Se houver dúvida, devolva o texto exatamente como entrou.
Retorne APENAS JSON válido: {"strings": ["...","..."]} mantendo o mesmo número de itens.`;

  const user = {
    role: 'user',
    content: JSON.stringify({ strings: inputStrings }),
  };

  const useResponses = /^gpt-5/i.test(String(model));
  let content = "";

  if (useResponses) {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model,
	        input: [
	          { role: "system", content: [{ type: "input_text", text: system }] },
	          { role: "user", content: [{ type: "input_text", text: user.content }] }
	        ],
	        text: { verbosity: "low" },
	        max_output_tokens: 1400
	      })
	    });
    if (!resp.ok) return { output: inputStrings };
    const json = await resp.json().catch(() => null);
    content = collectOutputText(json) || "";
  } else {
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        user
      ]
    };
    if (/^gpt-5/i.test(String(model))) body.max_completion_tokens = 2000;
    else body.max_tokens = 2000;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) return { output: inputStrings };
    const json = await resp.json().catch(() => null);
    content = json?.choices?.[0]?.message?.content || "";
  }

  const parsed = extractJson(content || '');
  const out = Array.isArray(parsed?.strings) ? parsed.strings.map((s) => String(s ?? '')) : null;
  if (!out || out.length !== inputStrings.length) return { output: inputStrings, usedModel: model };

  const safe = inputStrings.map((orig, idx) => {
    const candidate = out[idx] ?? orig;
    return isSafePolish(orig, candidate) ? candidate : orig;
  });

  return { output: safe, usedModel: model };
}
