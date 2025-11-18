// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);

function levelToDifficulty(level: number): string {
  if (level <= 3) return 'basica';
  if (level <= 6) return 'intermediaria';
  if (level <= 8) return 'avancada';
  return 'especialista';
}

function levelToXp(level: number): number {
  if (level <= 3) return 5;
  if (level <= 5) return 10;
  if (level <= 7) return 20;
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

    const { topic, quiz } = req.body || {};
    if (!quiz || !Array.isArray(quiz.questoes) || quiz.questoes.length === 0) {
      return res.status(400).json({ error: 'Quiz inválido' });
    }

    const title = `Quiz do Milhão: ${String(topic || quiz.title || '').trim() || 'Desafio'}`;
    const description =
      String(quiz.description || '').trim() ||
      'Quiz do Milhão com 10 perguntas progressivas de conhecimento técnico DJT/CPFL.';

    const { data: challenge, error: chErr } = await admin
      .from('challenges')
      .insert({
        title,
        description,
        type: 'quiz',
        xp_reward: 0,
        evidence_required: false,
        require_two_leader_eval: false,
        quiz_specialties: quiz.specialties || null,
        chas_dimension: quiz.chas || 'C',
      } as any)
      .select()
      .single();

    if (chErr) return res.status(400).json({ error: chErr.message });

    let totalXp = 0;
    for (let idx = 0; idx < quiz.questoes.length; idx++) {
      const q = quiz.questoes[idx];
      const level = Number(q.nivel || idx + 1);
      const difficulty_level = levelToDifficulty(level);
      const xp_value = levelToXp(level);
      totalXp += xp_value;

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
      if (qErr) return res.status(400).json({ error: qErr.message });

      const alternativas = q.alternativas || {};
      const correctKey = q.correta || 'A';
      const rows = ['A', 'B', 'C', 'D']
        .filter((k) => alternativas[k])
        .map((k) => ({
          question_id: question.id,
          option_text: alternativas[k],
          is_correct: k === correctKey,
          explanation: null,
        }));

      if (rows.length) {
        const { error: optErr } = await admin.from('quiz_options').insert(rows as any);
        if (optErr) return res.status(400).json({ error: optErr.message });
      }
    }

    // Atualizar xp_reward resumido do desafio
    try {
      await admin.from('challenges').update({ xp_reward: totalXp }).eq('id', challenge.id);
    } catch {/* ignore */}

    return res.status(200).json({ success: true, challengeId: challenge.id, title: challenge.title });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

