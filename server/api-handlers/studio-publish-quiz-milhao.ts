// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { proofreadPtBrStrings } from '../lib/ai-proofread-ptbr';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;
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

function levelToDifficulty(level: number): string {
  // OBS: precisa respeitar o CHECK do banco (basico/intermediario/avancado/especialista)
  if (level <= 3) return 'basico';
  if (level <= 6) return 'intermediario';
  if (level <= 8) return 'avancado';
  return 'especialista';
}

function levelToXp(level: number): number {
  // OBS: precisa respeitar o CHECK do banco (5,10,20,40)
  if (level <= 3) return 5;
  if (level <= 6) return 10;
  if (level <= 9) return 20;
  return 40;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase config' });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers['authorization'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });
    const uid = userData.user.id;

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', uid);
    const roles = (rolesRows || []).map((r: any) => r.role as string);
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
    const rewardTotalXp =
      Number.isFinite(rewardTotalXpRaw) ? Math.max(100, Math.min(5000, Math.floor(rewardTotalXpRaw))) : DEFAULT_MILHAO_TOTAL_XP;
    const rewardTierSteps =
      Number.isFinite(rewardTierStepsRaw) ? Math.max(1, Math.min(5, Math.floor(rewardTierStepsRaw))) : 1;

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
      } as any)
      .select()
      .single();

    if (chErr) return res.status(400).json({ error: chErr.message });

    const createdQuestionIds: string[] = [];
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
      const texts: string[] = [];
      for (const q of quiz.questoes || []) {
        texts.push(String(q?.enunciado || ''));
        const alternativas = q?.alternativas || {};
        for (const k of ['A', 'B', 'C', 'D']) {
          texts.push(String(alternativas?.[k] || ''));
        }
      }
      const { output } = await proofreadPtBrStrings({ strings: texts });
      let cursor = 0;
      revisedQuiz = { ...quiz, questoes: (quiz.questoes || []).map((q: any) => {
        const enunciado = output[cursor++] ?? q.enunciado;
        const alternativasIn = q?.alternativas || {};
        const alternativasOut: any = { ...alternativasIn };
        for (const k of ['A','B','C','D']) {
          alternativasOut[k] = output[cursor++] ?? alternativasIn[k];
        }
        return { ...q, enunciado, alternativas: alternativasOut };
      })};
    } catch {
      // ignore
    }

    try {
      for (let idx = 0; idx < revisedQuiz.questoes.length; idx++) {
        const q = revisedQuiz.questoes[idx];
        const level = Number(q.nivel || idx + 1);
        const difficulty_level = levelToDifficulty(level);
        const xp_value = levelToXp(level);

        // Validar alternativas (4 e exatamente 1 correta) antes de inserir
        const alternativas = q.alternativas || {};
        const correctKey = String(q.correta || 'A').trim().toUpperCase();
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
          } as any)
          .select()
          .single();
        if (qErr) throw new Error(qErr.message);
        createdQuestionIds.push(question.id);

        const rows = ['A', 'B', 'C', 'D'].map((k) => ({
          question_id: question.id,
          option_text: alternativas[k],
          is_correct: k === correctKey,
          explanation: null,
        }));

        const { error: optErr } = await admin.from('quiz_options').insert(rows as any);
        if (optErr) throw new Error(optErr.message);
      }
    } catch (e: any) {
      await cleanup();
      return res.status(400).json({ error: e?.message || 'Falha ao publicar Quiz do Milhão' });
    }

    return res.status(200).json({ success: true, challengeId: challenge.id, title: challenge.title });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
