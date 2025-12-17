import { tryInsertAuditLog } from './audit-log.js';

async function fetchQuizSnapshot(admin, challengeId) {
  const { data: challenge, error: chErr } = await admin
    .from('challenges')
    .select('*')
    .eq('id', challengeId)
    .maybeSingle();
  if (chErr) throw chErr;
  if (!challenge) throw new Error('Quiz not found');

  const { data: questions, error: qErr } = await admin
    .from('quiz_questions')
    .select('id, question_text, difficulty_level, xp_value, order_index, created_at, created_by')
    .eq('challenge_id', challengeId)
    .order('order_index', { ascending: true });
  if (qErr) throw qErr;

  const questionIds = (questions || []).map((q) => q.id);
  let options = [];
  if (questionIds.length) {
    const { data: opts, error: oErr } = await admin
      .from('quiz_options')
      .select('id, question_id, option_text, is_correct, explanation, created_at')
      .in('question_id', questionIds);
    if (oErr) throw oErr;
    options = opts || [];
  }

  const optionsByQ = new Map();
  for (const opt of options) {
    const qid = String(opt.question_id || '');
    if (!optionsByQ.has(qid)) optionsByQ.set(qid, []);
    optionsByQ.get(qid).push(opt);
  }

  const snapshot = {
    challenge,
    questions: (questions || []).map((q) => ({
      ...q,
      options: optionsByQ.get(String(q.id)) || [],
    })),
  };
  return snapshot;
}

async function nextVersionNumber(admin, challengeId) {
  const { data, error } = await admin
    .from('quiz_versions')
    .select('version_number')
    .eq('challenge_id', challengeId)
    .order('version_number', { ascending: false })
    .limit(1);
  if (error) throw error;
  const n = Number(data?.[0]?.version_number || 0);
  return (Number.isFinite(n) ? n : 0) + 1;
}

export async function snapshotQuizVersion(admin, params) {
  const { challengeId, actorId, reason, auditAction } = params || {};
  if (!challengeId) throw new Error('challengeId required');

  const snapshot = await fetchQuizSnapshot(admin, challengeId);
  const version_number = await nextVersionNumber(admin, challengeId);

  const { error } = await admin.from('quiz_versions').insert({
    challenge_id: challengeId,
    version_number,
    snapshot_json: snapshot,
    created_by: actorId || null,
    reason: reason ? String(reason).slice(0, 400) : null,
  });
  if (error) throw error;

  if (auditAction) {
    await tryInsertAuditLog(admin, {
      actor_id: actorId || null,
      action: auditAction,
      entity_type: 'quiz',
      entity_id: String(challengeId),
      before_json: null,
      after_json: { version_number, reason: reason || null },
    });
  }

  return { version_number, snapshot };
}

