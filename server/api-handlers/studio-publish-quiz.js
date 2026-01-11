import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, hasRole, ROLE } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';

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
      after_json: { ...after, awarded },
    });

    return res.status(200).json({ success: true, quiz: after, awarded });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

