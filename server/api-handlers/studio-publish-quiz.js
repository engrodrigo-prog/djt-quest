import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, hasRole, ROLE } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';
import { proofreadPtBrStrings } from '../lib/ai-proofread-ptbr.js';

const LEADER_ROLES = new Set([
  ROLE.TEAM_LEADER,
  ROLE.COORD,
  ROLE.DIV_MANAGER,
  ROLE.MANAGER,
  // compat legado
  'coordenador',
  'lider_divisao',
  'gerente',
]);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { challengeId } = req.body || {};
    const id = String(challengeId || '').trim();
    if (!id) return res.status(400).json({ error: 'challengeId required' });

    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', caller.id),
      admin.from('profiles').select('is_leader').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);
    const isAdmin = hasRole(roleSet, ROLE.ADMIN);
    const isLeader = Boolean(callerProfile?.is_leader) || Array.from(LEADER_ROLES).some((r) => roleSet.has(r));
    if (!isAdmin && !isLeader) return res.status(403).json({ error: 'Apenas líderes podem publicar quizzes' });

    const { data: before, error: chErr } = await admin.from('challenges').select('*').eq('id', id).maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!before) return res.status(404).json({ error: 'Quiz not found' });
    if (String(before.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const workflow = String(before.quiz_workflow_status || 'PUBLISHED');
    if (workflow !== 'DRAFT') return res.status(400).json({ error: 'Quiz não está em rascunho (DRAFT)' });

    const ownerId = String(before.owner_id || before.created_by || '');
    if (!isAdmin && ownerId && ownerId !== caller.id) {
      return res.status(403).json({ error: 'Você só pode publicar seus próprios quizzes' });
    }

    const { count: qCount, error: qErr } = await admin
      .from('quiz_questions')
      .select('id', { count: 'exact', head: true })
      .eq('challenge_id', id);
    if (qErr) return res.status(400).json({ error: qErr.message });
    if (!qCount || qCount < 1) return res.status(400).json({ error: 'Adicione ao menos 1 pergunta antes de publicar' });

    // Snapshot at publish point (best-effort)
    try {
      await snapshotQuizVersion(admin, { challengeId: id, actorId: caller.id, reason: 'publish', auditAction: 'quiz.version.snapshot' });
    } catch {
      // ignore
    }

    // Revisão ortográfica (IA) antes de publicar (best-effort).
    let proofreadUpdated = 0;
    try {
      const safeTrim = (v) => String(v ?? '').trim();
      const title = String(before?.title || '');
      const desc = before?.description == null ? '' : String(before?.description || '');
      const { output } = await proofreadPtBrStrings({ strings: [title, desc] });
      const nextTitle = output?.[0] ?? title;
      const nextDesc = output?.[1] ?? desc;
      const updates = {};
      if (safeTrim(nextTitle) && nextTitle !== title) updates.title = nextTitle;
      if (before?.description != null && nextDesc !== desc) updates.description = nextDesc;
      if (Object.keys(updates).length) {
        const { error: upErr } = await admin.from('challenges').update(updates).eq('id', id);
        if (!upErr) proofreadUpdated += Object.keys(updates).length;
      }

      const { data: questions } = await admin
        .from('quiz_questions')
        .select('id, question_text, order_index')
        .eq('challenge_id', id)
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
        let out = strings;
        try {
          const resp = await proofreadPtBrStrings({ strings });
          out = Array.isArray(resp?.output) ? resp.output : strings;
        } catch {
          out = strings;
        }

        const nextQuestionText = out?.[0] ?? strings[0];
        if (safeTrim(nextQuestionText) && nextQuestionText !== String(q?.question_text || '')) {
          const { error: qUpErr } = await admin.from('quiz_questions').update({ question_text: nextQuestionText }).eq('id', qid);
          if (!qUpErr) proofreadUpdated += 1;
        }

        const n = opts.length;
        for (let i = 0; i < n; i++) {
          const opt = opts[i];
          const oid = String(opt?.id || '').trim();
          if (!oid) continue;
          const prevOptText = String(opt?.option_text || '');
          const prevExpl = opt?.explanation == null ? null : String(opt?.explanation || '');
          const nextOptText = out?.[1 + i] ?? prevOptText;
          const nextExpl = out?.[1 + n + i] ?? (prevExpl || '');
          const up = {};
          if (safeTrim(nextOptText) && nextOptText !== prevOptText) up.option_text = nextOptText;
          if (prevExpl != null && nextExpl !== prevExpl) up.explanation = nextExpl;
          if (Object.keys(up).length) {
            const { error: oUpErr } = await admin.from('quiz_options').update(up).eq('id', oid);
            if (!oUpErr) proofreadUpdated += Object.keys(up).length;
          }
        }
      }
    } catch {
      // ignore
    }

    const now = new Date().toISOString();
    const { data: after, error } = await admin
      .from('challenges')
      .update({
        quiz_workflow_status: 'PUBLISHED',
        published_at: now,
        published_by: caller.id,
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });

    let awarded = false;
    if (isLeader && !isAdmin) {
      try {
        const { data: awardRow, error: awardErr } = await admin
          .from('xp_awards')
          .insert({
            user_id: caller.id,
            kind: 'quiz_publish',
            amount: 100,
            quiz_id: id,
            metadata: { quiz_id: id },
          })
          .select('id')
          .maybeSingle();

        if (!awardErr && awardRow?.id) {
          await admin.rpc('increment_user_xp', { _user_id: caller.id, _xp_to_add: 100 });
          awarded = true;
        }
      } catch {
        // ignore if xp_awards doesn't exist yet or insert fails
      }
    }

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.publish.direct',
      entity_type: 'quiz',
      entity_id: id,
      before_json: before,
      after_json: { ...after, awarded, proofread: { updated: proofreadUpdated } },
    });

    return res.status(200).json({ success: true, quiz: after, awarded });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
