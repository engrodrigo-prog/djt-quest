import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';
import { proofreadPtBrStrings } from '../lib/ai-proofread-ptbr.js';

const safeTrim = (v) => String(v ?? '').trim();

const proofreadQuizOrthography = async (admin, quizRow) => {
  const challengeId = String(quizRow?.id || '').trim();
  if (!challengeId) return { updated: 0 };

  let updated = 0;

  // 1) Title/description
  try {
    const title = String(quizRow?.title || '');
    const desc = quizRow?.description == null ? '' : String(quizRow?.description || '');
    const { output } = await proofreadPtBrStrings({ strings: [title, desc] });
    const nextTitle = output?.[0] ?? title;
    const nextDesc = output?.[1] ?? desc;
    const updates = {};
    if (safeTrim(nextTitle) && nextTitle !== title) updates.title = nextTitle;
    if (quizRow?.description != null && nextDesc !== desc) updates.description = nextDesc;
    if (Object.keys(updates).length) {
      const { error } = await admin.from('challenges').update(updates).eq('id', challengeId);
      if (!error) updated += Object.keys(updates).length;
    }
  } catch {
    // ignore proofread failures
  }

  // 2) Questions + options
  const { data: questions } = await admin
    .from('quiz_questions')
    .select('id, question_text, order_index')
    .eq('challenge_id', challengeId)
    .order('order_index', { ascending: true });

  for (const q of questions || []) {
    const qid = String(q?.id || '').trim();
    if (!qid) continue;
    const { data: options } = await admin
      .from('quiz_options')
      .select('id, option_text, explanation')
      .eq('question_id', qid)
      .order('id', { ascending: true });

    const opts = Array.isArray(options) ? options : [];
    const strings = [
      String(q?.question_text || ''),
      ...opts.map((o) => String(o?.option_text || '')),
      ...opts.map((o) => String(o?.explanation || '')),
    ];

    let output = strings;
    try {
      const resp = await proofreadPtBrStrings({ strings });
      output = Array.isArray(resp?.output) ? resp.output : strings;
    } catch {
      output = strings;
    }

    const nextQuestionText = output?.[0] ?? strings[0];
    if (safeTrim(nextQuestionText) && nextQuestionText !== String(q?.question_text || '')) {
      const { error } = await admin.from('quiz_questions').update({ question_text: nextQuestionText }).eq('id', qid);
      if (!error) updated += 1;
    }

    const n = opts.length;
    for (let i = 0; i < n; i++) {
      const opt = opts[i];
      const oid = String(opt?.id || '').trim();
      if (!oid) continue;

      const prevOptText = String(opt?.option_text || '');
      const prevExpl = opt?.explanation == null ? null : String(opt?.explanation || '');
      const nextOptText = output?.[1 + i] ?? prevOptText;
      const nextExpl = output?.[1 + n + i] ?? (prevExpl || '');

      const up = {};
      if (safeTrim(nextOptText) && nextOptText !== prevOptText) up.option_text = nextOptText;
      if (prevExpl != null && nextExpl !== prevExpl) up.explanation = nextExpl;

      if (Object.keys(up).length) {
        const { error } = await admin.from('quiz_options').update(up).eq('id', oid);
        if (!error) updated += Object.keys(up).length;
      }
    }
  }

  return { updated };
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { challengeId } = req.body || {};
    const id = String(challengeId || '').trim();
    if (!id) return res.status(400).json({ error: 'challengeId required' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canCurate({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const { data: before, error: chErr } = await admin.from('challenges').select('*').eq('id', id).maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!before) return res.status(404).json({ error: 'Quiz not found' });
    if (String(before.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const workflow = String(before.quiz_workflow_status || 'PUBLISHED');
    if (workflow !== 'APPROVED') return res.status(400).json({ error: 'Quiz is not in APPROVED' });

    // Snapshot at publish point
    try {
      await snapshotQuizVersion(admin, { challengeId: id, actorId: caller.id, reason: 'publish', auditAction: 'quiz.version.snapshot' });
    } catch {
      // ignore
    }

    // Revisão ortográfica (IA) antes de publicar (best-effort; preserva conteúdo).
    let proofreadMeta = { updated: 0 };
    try {
      proofreadMeta = await proofreadQuizOrthography(admin, before);
    } catch {
      proofreadMeta = { updated: 0 };
    }

    const { data: after, error } = await admin
      .from('challenges')
      .update({ quiz_workflow_status: 'PUBLISHED', published_at: new Date().toISOString(), published_by: caller.id })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.publish',
      entity_type: 'quiz',
      entity_id: id,
      before_json: before,
      after_json: { ...after, proofread: proofreadMeta },
    });

    return res.status(200).json({ success: true, quiz: after });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
