import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const qid =
      String((req.method === 'GET' ? req.query?.questionId : req.body?.questionId) || '').trim();
    if (!qid) return res.status(400).json({ error: 'questionId required' });

    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', caller.id),
      admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });
    const isCurator = canCurate({ roleSet, profile: callerProfile });

    const { data: question, error: qErr } = await admin
      .from('quiz_questions')
      .select('id, challenge_id, question_text, difficulty_level, xp_value, order_index, created_at, created_by')
      .eq('id', qid)
      .maybeSingle();
    if (qErr) return res.status(400).json({ error: qErr.message });
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const challengeId = question.challenge_id;
    const { data: quiz, error: chErr } = await admin
      .from('challenges')
      .select('id, type, owner_id, created_by, quiz_workflow_status')
      .eq('id', challengeId)
      .maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (String(quiz.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const isOwner = String(quiz.owner_id || '') === caller.id || String(quiz.created_by || '') === caller.id;
    const workflow = String(quiz.quiz_workflow_status || 'PUBLISHED');

    if (workflow === 'DRAFT' || workflow === 'REJECTED') {
      if (!isOwner && !isCurator) return res.status(403).json({ error: 'Forbidden' });
    } else {
      if (!isCurator) return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: options, error: oErr } = await admin
      .from('quiz_options')
      .select('id, question_id, option_text, is_correct, explanation, created_at')
      .eq('question_id', qid);
    if (oErr) return res.status(400).json({ error: oErr.message });

    return res.status(200).json({
      question,
      quiz: { id: quiz.id, workflow, owner_id: quiz.owner_id, created_by: quiz.created_by },
      options: Array.isArray(options) ? options : [],
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

