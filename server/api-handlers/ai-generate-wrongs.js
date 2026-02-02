import { normalizeChatModel } from '../lib/openai-models.js';
import { parseJsonFromAiContent } from '../lib/ai-curation-provider.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_DISTRACTOR_MODEL = normalizeChatModel(
  process.env.OPENAI_QUIZ_DISTRACTOR_MODEL ||
    process.env.OPENAI_MODEL_PREMIUM ||
    process.env.OPENAI_TEXT_MODEL ||
    process.env.OPENAI_MODEL_FAST ||
    process.env.OPENAI_MODEL_OVERRIDE ||
    'gpt-5-2025-08-07',
  'gpt-5-2025-08-07',
);

const BANNED_TERMS_RE = /smart\s*line|smartline|smarline/i;
const LOW_QUALITY_RE = /\b(procedimento semelhante|conceito relacionado|condi[cç][aã]o parcialmente|alternativa plaus[ií]vel)\b/i;

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const jaccard = (a, b) => {
  const as = new Set(String(a || '').split(' ').filter(Boolean));
  const bs = new Set(String(b || '').split(' ').filter(Boolean));
  if (!as.size || !bs.size) return 0;
  let inter = 0;
  for (const v of as) if (bs.has(v)) inter += 1;
  return inter / (as.size + bs.size - inter);
};

const tooSimilar = (a, b) => {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return jaccard(na, nb) >= 0.85;
};

const clampCount = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(Math.floor(n), 3));
};

const withTimeout = async (promise, ms) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
};

const formatGlobalContext = (context) => {
  if (!context) return '';
  if (typeof context === 'string') {
    const s = context.trim();
    if (!s) return '';
    return `\n\nContexto global do quiz (para consistência):\n${s.slice(0, 2400)}`;
  }
  if (Array.isArray(context)) {
    const lines = context
      .map((it, idx) => {
        const q = String(it?.question || it?.question_text || '').trim();
        const a = String(it?.correct || it?.correct_text || '').trim();
        if (!q || !a) return null;
        return `- Q${idx + 1}: ${q.slice(0, 240)}\n  Correta: ${a.slice(0, 240)}`;
      })
      .filter(Boolean)
      .slice(0, 20);
    if (!lines.length) return '';
    return `\n\nContexto global do quiz (para consistência):\n${lines.join('\n')}`.slice(0, 2600);
  }
  return '';
};

const callOpenAiForWrongs = async ({
  question,
  correct,
  difficulty,
  language,
  count,
  avoid = [],
  context,
}) => {
  const model = OPENAI_DISTRACTOR_MODEL;
  const isGpt5 = /^gpt-5/i.test(String(model));

  const sys = `Você gera alternativas INCORRETAS (distratores) plausíveis e verossímeis para perguntas de múltipla escolha em ${language}.
Regras:
- Gere alternativas verossímeis, factíveis, mas ERRADAS *dentro do contexto da pergunta*.
- Use a própria pergunta + resposta correta para inferir restrições (tensão, condição, finalidade, procedimento, critérios).
- Mantenha o mesmo estilo/estrutura gramatical da resposta correta (ex.: se a correta começa com verbo no infinitivo, as erradas também).
- Cada errada deve ser "quase certa" porém falhar em UM detalhe crítico (parâmetro, objetivo, etapa, condição, equipamento, norma, unidade).
- Evite negações simples (“não …”), reordenação trivial, ou sinônimos óbvios da correta.
- Evite alternativas genéricas; toda alternativa precisa mencionar um elemento específico do domínio (ex.: tensão/ensaio/procedimento/equipamento).
- Não use "todas as alternativas", "nenhuma das alternativas", nem pegadinhas óbvias.
- Adeque a dificuldade (basico/intermediario/avancado/especialista).
- Proibido mencionar SmartLine/Smartline/Smart Line.
- Retorne APENAS JSON válido no formato: {"items":[{"text":"...","explanation":"..."}]} (sem texto extra).

Em "explanation", explique em 1 frase por que a alternativa é incorreta, de forma objetiva (pode mencionar o detalhe que quebra a alternativa).`;

  const avoidLines = Array.isArray(avoid) && avoid.length
    ? `\nEvite também (não repita):\n- ${avoid.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 12).join('\n- ')}`
    : '';

  const ctx = formatGlobalContext(context);

  const user = `Gere ${count} alternativas erradas (somente erradas).
Pergunta: ${String(question || '').trim()}
Resposta correta: ${String(correct || '').trim()}
Nível: ${String(difficulty || '').trim()}${avoidLines}${ctx}`;

  return withTimeout(async (signal) => {
    const body = {
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      ...(isGpt5 ? { max_completion_tokens: 650 } : { max_tokens: 650, temperature: 0.7 }),
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    const json = await resp.json().catch(() => null);
    const content = json?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonFromAiContent(content).parsed;
    const items = Array.isArray(parsed?.items) ? parsed.items : [];

    if (!resp.ok) {
      const msg = json?.error?.message || `OpenAI error (${resp.status})`;
      throw new Error(msg);
    }

    return items;
  }, 25000);
};

export async function generateWrongOptions({
  question,
  correct,
  difficulty = 'basico',
  language = 'pt-BR',
  count = 3,
  context,
  avoid = [],
} = {}) {
  const target = clampCount(count);
  const correctText = String(correct || '').trim();

  const accepted = [];
  const seen = new Set();
  let usedAi = false;
  for (const a of Array.isArray(avoid) ? avoid : []) {
    const k = normalizeText(a);
    if (k) seen.add(k);
  }

  const acceptCandidate = (cand, { allowLowQuality = false } = {}) => {
    const text = String(cand?.text || '').trim();
    if (!text) return false;
    if (BANNED_TERMS_RE.test(text)) return false;
    if (!allowLowQuality && LOW_QUALITY_RE.test(text)) return false;
    if (tooSimilar(text, correctText)) return false;
    const key = normalizeText(text);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    accepted.push({ text, explanation: String(cand?.explanation || '').trim() });
    return true;
  };

  // Try OpenAI first (up to 2 passes), then fallback.
  if (OPENAI_API_KEY) {
    for (let pass = 0; pass < 2 && accepted.length < target; pass += 1) {
      try {
        const want = Math.max(10, target * 4);
        const raw = await callOpenAiForWrongs({
          question,
          correct: correctText,
          difficulty,
          language,
          count: want,
          avoid: [...(Array.isArray(avoid) ? avoid : []), ...accepted.map((a) => a.text)],
          context,
        });
        if (Array.isArray(raw) && raw.length) usedAi = true;
        for (const item of Array.isArray(raw) ? raw : []) {
          if (accepted.length >= target) break;
          acceptCandidate(item);
        }
      } catch {
        // ignore and fallback
      }
    }
  }

  if (accepted.length < target) {
    // Heuristic fallback: best-effort distractors.
    const base = correctText;
    const variants = [];

    const nums = String(base).match(/-?\d+(?:[.,]\d+)?/g) || [];
    if (nums.length) {
      const parsedNums = nums
        .map((n) => Number(String(n).replace(',', '.')))
        .filter((n) => Number.isFinite(n));
      const n0 = parsedNums[0];
      if (Number.isFinite(n0)) {
        variants.push(String(base).replace(nums[0], String(n0 + 1)));
        variants.push(String(base).replace(nums[0], String(Math.max(0, n0 - 1))));
        variants.push(String(base).replace(nums[0], String(Math.max(1, Math.round(n0 * 1.5)))));
      }
    }

    // Use question keywords to make fallback less genérico.
    const tokens = String(question || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 5)
      .slice(0, 6);
    const hint = tokens.length ? ` (${tokens.join(', ')})` : '';

    variants.push(`Identificar falhas em outro componente do sistema${hint}.`);
    variants.push(`Confirmar requisito de operação, mas sem avaliar o isolamento${hint}.`);
    variants.push(`Verificar continuidade/ajuste, sem aplicar o estresse elétrico do ensaio${hint}.`);

    for (const v of variants) {
      if (accepted.length >= target) break;
      acceptCandidate({ text: v, explanation: '' }, { allowLowQuality: true });
    }
  }

  // As last resort, pad.
  const pads = [
    'Verificar um parâmetro relacionado, mas não o objetivo do ensaio.',
    'Executar um passo correto, porém na condição de equipamento errada.',
    'Aplicar critério de outro teste semelhante.',
  ];
  while (accepted.length < target) {
    const next = pads[accepted.length % pads.length];
    acceptCandidate({ text: next, explanation: '' }, { allowLowQuality: true });
  }

  return { wrong: accepted.slice(0, target), usedAi: Boolean(OPENAI_API_KEY && usedAi) };
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        const { question, correct, difficulty = 'basico', language = 'pt-BR', count = 3, context, avoid } = req.body || {};
        if (!question || !correct) {
            return res.status(400).json({ error: 'Campos obrigatórios: question, correct' });
        }
        const out = await generateWrongOptions({ question, correct, difficulty, language, count, context, avoid });
        return res.status(200).json({ wrong: out.wrong, meta: { usedAi: out.usedAi, model: OPENAI_DISTRACTOR_MODEL } });
    }
    catch (err) {
        return res.status(500).json({ error: err?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
