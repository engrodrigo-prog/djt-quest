// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { proofreadPtBrStrings } from '../lib/ai-proofread-ptbr.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const BANNED_TERMS_RE = /smart\s*line|smartline|smarline/i;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const STAFF_ROLES = new Set([
  'admin',
  'gerente_djt',
  'gerente_divisao_djtx',
  'coordenador_djtx',
  // Compat legado
  'gerente',
  'lider_divisao',
  'coordenador',
  'lider_equipe',
]);

const DEFAULT_MILHAO_TOTAL_XP = 1000;

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

const tokenSet = (s) => new Set(baseNormalize(s).split(' ').filter(Boolean));
const jaccard = (a, b) => {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const v of A) if (B.has(v)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
};

const isSafeDisambiguation = (original, candidate) => {
  const o = String(original || '').trim();
  const c = String(candidate || '').trim();
  if (!o || !c) return false;
  if (c.length < Math.max(12, Math.floor(o.length * 0.6))) return false;
  if (c.length > Math.floor(o.length * 1.8) + 20) return false;
  if (BANNED_TERMS_RE.test(c)) return false;
  return jaccard(o, c) >= 0.55;
};

async function generateExplanationsAndDisambiguations(params) {
  const { model, language, questions } = params;
  if (!OPENAI_API_KEY) return null;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const payload = questions.map((q, idx) => ({
    index: idx + 1,
    question_text: String(q?.enunciado || ''),
    options: q?.alternativas || {},
    correct_letter: String(q?.correta || 'A').trim().toUpperCase(),
  }));

  const system = `Você é um instrutor técnico do setor elétrico (SEP/subestações/proteção), em ${language}.
Sua tarefa:
1) Gerar explicações curtas para cada alternativa (A-D).
2) Detectar ambiguidade: se mais de UMA alternativa puder ser considerada correta, sugerir um ajuste mínimo no ENUNCIADO (question_text) para que SOMENTE a alternativa indicada em correct_letter seja correta.

Regras obrigatórias:
- NÃO altere o texto das alternativas; apenas explique.
- Explicações devem ter 1-2 frases, objetivas e didáticas.
- Para a alternativa correta: explique por que é correta.
- Para alternativas erradas: explique por que NÃO atendem ao enunciado (sem humilhar; sem ser genérico demais).
- Não invente “padrões internos” se eles não estiverem explícitos no enunciado/opções; prefira justificar por aderência ao critério do enunciado.
- Proibido mencionar SmartLine/Smartline/Smart Line.
- Não cite marcas/programas de TV.

Saída: responda APENAS JSON válido, no formato:
{
  "items": [
    {
      "index": 1,
      "explanations": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "ambiguous": false,
      "suggested_question_text": null
    }
  ]
}`;

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify({ items: payload }) },
    ],
  };
  if (/^gpt-5/i.test(String(model))) body.max_completion_tokens = 2600;
  else body.max_tokens = 2600;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return null;

  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content || '';
  if (!content) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  }
  if (!parsed || !Array.isArray(parsed.items)) return null;

  const byIndex = new Map();
  for (const it of parsed.items) {
    const index = Number(it?.index);
    if (!Number.isFinite(index) || index < 1) continue;
    const explanations = it?.explanations || {};
    const out = {};
    for (const k of ['A', 'B', 'C', 'D']) {
      const v = String(explanations?.[k] || '').trim();
      if (!v) continue;
      if (BANNED_TERMS_RE.test(v)) continue;
      out[k] = v;
    }
    const ambiguous = Boolean(it?.ambiguous);
    const suggested = it?.suggested_question_text != null ? String(it.suggested_question_text) : null;
    byIndex.set(index, { explanations: out, ambiguous, suggested_question_text: suggested });
  }
  return byIndex;
}

function levelToDifficulty(level) {
  // OBS: precisa respeitar o CHECK do banco (basico/intermediario/avancado/especialista)
  if (level <= 3) return 'basico';
  if (level <= 6) return 'intermediario';
  if (level <= 8) return 'avancado';
  return 'especialista';
}

function levelToXp(level) {
  // OBS: precisa respeitar o CHECK do banco (5,10,20,40)
  if (level <= 3) return 5;
  if (level <= 6) return 10;
  if (level <= 9) return 20;
  return 40;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase config' });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });
    const uid = userData.user.id;

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', uid);
    const roles = (rolesRows || []).map((r) => r.role);
    const isStaff = roles.some((r) => STAFF_ROLES.has(r));
    if (!isStaff) return res.status(403).json({ error: 'Apenas líderes podem publicar Quiz do Milhão' });

    const { topic, quiz, reward } = req.body || {};
    if (!quiz || !Array.isArray(quiz.questoes) || quiz.questoes.length === 0) {
      return res.status(400).json({ error: 'Quiz inválido' });
    }

    const rewardModeRaw = String(reward?.mode || 'fixed_xp').trim();
    const rewardMode = rewardModeRaw === 'tier_steps' ? 'tier_steps' : 'fixed_xp';
    const rewardTotalXpRaw = Number(reward?.total_xp ?? DEFAULT_MILHAO_TOTAL_XP);
    const rewardTierStepsRaw = Number(reward?.tier_steps ?? 1);
    const rewardTotalXp = Number.isFinite(rewardTotalXpRaw)
      ? Math.max(100, Math.min(5000, Math.floor(rewardTotalXpRaw)))
      : DEFAULT_MILHAO_TOTAL_XP;
    const rewardTierSteps = Number.isFinite(rewardTierStepsRaw) ? Math.max(1, Math.min(5, Math.floor(rewardTierStepsRaw))) : 1;

    const title = `Quiz do Milhão: ${String(topic || quiz.title || '').trim() || 'Desafio'}`;
    const description =
      String(quiz.description || '').trim() ||
      'Quiz do Milhão com 10 perguntas progressivas de conhecimento técnico DJT/CPFL.';

    // Revisão ortográfica (IA) - não altera conteúdo, apenas corrige escrita/acentos.
    let revisedTitle = title;
    let revisedDescription = description;
    try {
      const { output } = await proofreadPtBrStrings({ strings: [title, description] });
      revisedTitle = output[0] || title;
      revisedDescription = output[1] || description;
    } catch {
      // ignore, publish as-is
    }

    const { data: challenge, error: chErr } = await admin
      .from('challenges')
      .insert({
        title: revisedTitle,
        description: revisedDescription,
        type: 'quiz',
        xp_reward: rewardMode === 'fixed_xp' ? rewardTotalXp : 0,
        reward_mode: rewardMode,
        reward_tier_steps: rewardMode === 'tier_steps' ? rewardTierSteps : null,
        evidence_required: false,
        require_two_leader_eval: false,
        quiz_specialties: quiz.specialties || null,
        chas_dimension: quiz.chas || 'C',
      })
      .select()
      .single();

    if (chErr) return res.status(400).json({ error: chErr.message });

    const createdQuestionIds = [];
    const cleanup = async () => {
      try {
        if (createdQuestionIds.length) {
          await admin.from('quiz_options').delete().in('question_id', createdQuestionIds);
          await admin.from('quiz_questions').delete().in('id', createdQuestionIds);
        } else {
          await admin.from('quiz_questions').delete().eq('challenge_id', challenge.id);
        }
      } catch {
        // ignore
      }
      try {
        await admin.from('challenges').delete().eq('id', challenge.id);
      } catch {
        // ignore
      }
    };

    // Revisão ortográfica (IA) do conteúdo do quiz: enunciados e alternativas.
    // Mantém sentido; apenas corrige acentuação/ortografia e pequenos erros de digitação.
    let revisedQuiz = quiz;
    try {
      const texts = [];
      for (const q of quiz.questoes || []) {
        texts.push(String(q?.enunciado || ''));
        const alternativas = q?.alternativas || {};
        for (const k of ['A', 'B', 'C', 'D']) texts.push(String(alternativas?.[k] || ''));
      }
      const { output } = await proofreadPtBrStrings({ strings: texts });
      let cursor = 0;
      revisedQuiz = {
        ...quiz,
        questoes: (quiz.questoes || []).map((q) => {
          const enunciado = output[cursor++] ?? q.enunciado;
          const alternativasIn = q?.alternativas || {};
          const alternativasOut = { ...alternativasIn };
          for (const k of ['A', 'B', 'C', 'D']) alternativasOut[k] = output[cursor++] ?? alternativasIn[k];
          return { ...q, enunciado, alternativas: alternativasOut };
        }),
      };
    } catch {
      // ignore
    }

    // Explicações (IA) e desambiguação mínima do enunciado (quando necessário).
    // NÃO altera alternativas; apenas adiciona explicações e, se detectada ambiguidade, ajusta o enunciado.
    let explanationsByIndex = null;
    try {
      const explainModel = process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_FAST || 'gpt-5-2025-08-07';
      explanationsByIndex = await generateExplanationsAndDisambiguations({
        model: explainModel,
        language: 'pt-BR',
        questions: revisedQuiz.questoes || [],
      });
      if (explanationsByIndex) {
        revisedQuiz = {
          ...revisedQuiz,
          questoes: (revisedQuiz.questoes || []).map((q, idx) => {
            const it = explanationsByIndex.get(idx + 1);
            const suggestion = it?.suggested_question_text;
            if (it?.ambiguous && suggestion && isSafeDisambiguation(q?.enunciado, suggestion)) {
              return { ...q, enunciado: suggestion };
            }
            return q;
          }),
        };
      }
    } catch {
      // ignore (publish without explanations)
    }

    try {
      for (let idx = 0; idx < revisedQuiz.questoes.length; idx++) {
        const q = revisedQuiz.questoes[idx];
        const level = Number(q.nivel || idx + 1);
        const difficulty_level = levelToDifficulty(level);
        const xp_value = levelToXp(level);

        const alternativas = q.alternativas || {};
        const correctKey = String(q.correta || 'A')
          .trim()
          .toUpperCase();
        const letters = ['A', 'B', 'C', 'D'];
        const presentLetters = letters.filter((k) => String(alternativas[k] || '').trim().length > 0);
        if (presentLetters.length !== 4) {
          throw new Error(`Questão ${idx + 1}: esperado 4 alternativas (A-D), recebido ${presentLetters.length}.`);
        }
        if (!letters.includes(correctKey)) {
          throw new Error(`Questão ${idx + 1}: letra correta inválida (${correctKey}).`);
        }

        const { data: question, error: qErr } = await admin
          .from('quiz_questions')
          .insert({
            challenge_id: challenge.id,
            question_text: q.enunciado || '',
            difficulty_level,
            xp_value,
            order_index: idx,
            created_by: uid,
          })
          .select()
          .single();
        if (qErr) throw new Error(qErr.message);
        createdQuestionIds.push(question.id);

        const explain = explanationsByIndex?.get(idx + 1)?.explanations || null;
        const rows = ['A', 'B', 'C', 'D'].map((k) => ({
          question_id: question.id,
          option_text: alternativas[k],
          is_correct: k === correctKey,
          explanation: explain?.[k] || null,
        }));

        const { error: optErr } = await admin.from('quiz_options').insert(rows);
        if (optErr) throw new Error(optErr.message);
      }
    } catch (e) {
      await cleanup();
      return res.status(400).json({ error: e?.message || 'Falha ao publicar Quiz do Milhão' });
    }

    return res.status(200).json({ success: true, challengeId: challenge.id, title: challenge.title });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
