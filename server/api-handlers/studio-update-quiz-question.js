import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';

const XP_BY_LEVEL = {
  basico: 5,
  intermediario: 10,
  avancado: 20,
  especialista: 50,
};

const normalizeOpt = (opt) => ({
  id: opt?.id ? String(opt.id).trim() : '',
  option_text: String(opt?.option_text || opt?.text || '').trim(),
  is_correct: Boolean(opt?.is_correct),
  explanation: opt?.explanation == null ? null : String(opt.explanation).trim(),
});

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { questionId, question_text, difficulty_level, options } = req.body || {};
    const qid = String(questionId || '').trim();
    if (!qid) return res.status(400).json({ error: 'questionId required' });

    const qText = String(question_text || '').trim();
    if (qText.length < 10) return res.status(400).json({ error: 'question_text inválido' });

    const dl = String(difficulty_level || '').trim();
    const xp = XP_BY_LEVEL[dl];
    if (!xp) return res.status(400).json({ error: 'difficulty_level inválido' });

    const opts = Array.isArray(options) ? options.map(normalizeOpt) : [];
    if (opts.length !== 4) return res.status(400).json({ error: 'options deve ter 4 alternativas' });
    if (opts.some((o) => o.option_text.length < 2)) return res.status(400).json({ error: 'Alternativa vazia' });
    const correctCount = opts.filter((o) => o.is_correct).length;
    if (correctCount !== 1) return res.status(400).json({ error: 'Precisa de exatamente 1 alternativa correta' });

    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', caller.id),
      admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });
    const isCurator = canCurate({ roleSet, profile: callerProfile });

    const { data: beforeQuestion, error: qErr } = await admin
      .from('quiz_questions')
      .select('id, challenge_id, question_text, difficulty_level, xp_value, order_index')
      .eq('id', qid)
      .maybeSingle();
    if (qErr) return res.status(400).json({ error: qErr.message });
    if (!beforeQuestion) return res.status(404).json({ error: 'Question not found' });

    const challengeId = beforeQuestion.challenge_id;
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
        await snapshotQuizVersion(admin, { challengeId, actorId: caller.id, reason: `update_question:${workflow}`, auditAction: 'quiz.version.snapshot' });
      } catch {
        // ignore
      }
    }

    const { data: beforeOptions, error: oErr } = await admin
      .from('quiz_options')
      .select('id, option_text, is_correct, explanation')
      .eq('question_id', qid);
    if (oErr) return res.status(400).json({ error: oErr.message });

    // Update quiz_questions row.
    const { data: afterQuestion, error: upQErr } = await admin
      .from('quiz_questions')
      .update({ question_text: qText, difficulty_level: dl, xp_value: xp })
      .eq('id', qid)
      .select('id, challenge_id, question_text, difficulty_level, xp_value, order_index')
      .maybeSingle();
    if (upQErr) return res.status(400).json({ error: upQErr.message });

    // Update options in place to preserve IDs (safer for published quizzes).
    const existing = Array.isArray(beforeOptions) ? beforeOptions : [];
    if (existing.length < 4 && workflow === 'PUBLISHED') {
      return res.status(400).json({ error: 'Quiz publicado: alternativas inválidas para edição' });
    }

    const byId = new Map(existing.map((o) => [String(o.id), o]));
    const existingIds = existing.map((o) => String(o.id));

    const assignTargetId = (opt, idx) => {
      const want = String(opt.id || '').trim();
      if (want && byId.has(want)) return want;
      return existingIds[idx] || '';
    };

    const updates = opts.map((opt, idx) => ({
      targetId: assignTargetId(opt, idx),
      option_text: opt.option_text,
      is_correct: opt.is_correct,
      explanation: opt.explanation && String(opt.explanation).trim().length ? String(opt.explanation).trim() : null,
    }));

    // Apply updates for existing IDs
    for (const u of updates) {
      if (!u.targetId) continue;
      const { error: upErr } = await admin
        .from('quiz_options')
        .update({ option_text: u.option_text, is_correct: u.is_correct, explanation: u.explanation })
        .eq('id', u.targetId);
      if (upErr) return res.status(400).json({ error: upErr.message });
    }

    // If in DRAFT and existing had extra options, clean up extras (best-effort).
    if (workflow === 'DRAFT' && existing.length > 4) {
      const keep = new Set(updates.map((u) => u.targetId).filter(Boolean));
      const extraIds = existingIds.filter((id) => id && !keep.has(id));
      if (extraIds.length) {
        try {
          await admin.from('quiz_options').delete().in('id', extraIds);
        } catch {
          // ignore
        }
      }
    }

    // If in DRAFT and existing had fewer, insert missing.
    if (workflow === 'DRAFT' && existing.length < 4) {
      const toInsert = updates
        .filter((u) => !u.targetId)
        .map((u) => ({
          question_id: qid,
          option_text: u.option_text,
          is_correct: u.is_correct,
          explanation: u.explanation,
        }));
      if (toInsert.length) {
        const { error: insErr } = await admin.from('quiz_options').insert(toInsert);
        if (insErr) return res.status(400).json({ error: insErr.message });
      }
    }

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.question.update',
      entity_type: 'quiz_question',
      entity_id: qid,
      before_json: { question: beforeQuestion, options: beforeOptions || [] },
      after_json: { question: afterQuestion, options: updates },
    });

    return res.status(200).json({ success: true, question: afterQuestion });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
