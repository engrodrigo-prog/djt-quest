import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);
    const { questionId } = req.body || {};
    const qid = String(questionId || '').trim();
    if (!qid) return res.status(400).json({ error: 'questionId required' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const isCurator = canCurate(roleSet);

    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const { data: question, error: qErr } = await admin
      .from('quiz_questions')
      .select('id, challenge_id')
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

    if (workflow === 'DRAFT') {
      if (!isOwner && !isCurator) return res.status(403).json({ error: 'Forbidden' });
    } else if (workflow === 'REJECTED') {
      if (!isOwner) return res.status(403).json({ error: 'Forbidden' });
      try {
        await snapshotQuizVersion(admin, { challengeId, actorId: caller.id, reason: 'edit:REJECTED', auditAction: 'quiz.version.snapshot' });
      } catch {
        // ignore
      }
      await admin.from('challenges').update({ quiz_workflow_status: 'DRAFT', approved_at: null, approved_by: null }).eq('id', challengeId);
    } else {
      if (!isCurator) return res.status(403).json({ error: 'Forbidden' });
      try {
        await snapshotQuizVersion(admin, { challengeId, actorId: caller.id, reason: `delete_question:${workflow}`, auditAction: 'quiz.version.snapshot' });
      } catch {
        // ignore
      }
    }

    const { error: delOptsErr } = await admin.from('quiz_options').delete().eq('question_id', qid);
    if (delOptsErr) return res.status(400).json({ error: delOptsErr.message });
    const { error: delQErr } = await admin.from('quiz_questions').delete().eq('id', qid);
    if (delQErr) return res.status(400).json({ error: delQErr.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.question.delete',
      entity_type: 'quiz_question',
      entity_id: qid,
      before_json: { challenge_id: challengeId },
      after_json: null,
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
