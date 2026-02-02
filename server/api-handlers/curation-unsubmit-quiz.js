import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';
import { rolesToSet, canAccessStudio } from '../lib/rbac.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', caller.id),
      admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const { challengeId } = req.body || {};
    const id = String(challengeId || '').trim();
    if (!id) return res.status(400).json({ error: 'challengeId required' });

    const { data: before, error: chErr } = await admin.from('challenges').select('*').eq('id', id).maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!before) return res.status(404).json({ error: 'Quiz not found' });
    if (String(before.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const isOwner = String(before.owner_id || '') === caller.id || String(before.created_by || '') === caller.id;
    if (!isOwner) return res.status(403).json({ error: 'Forbidden' });

    const workflow = String(before.quiz_workflow_status || 'PUBLISHED');
    if (workflow !== 'SUBMITTED') return res.status(400).json({ error: 'Quiz is not in SUBMITTED' });

    // Snapshot at unsubmit point (best-effort)
    try {
      await snapshotQuizVersion(admin, {
        challengeId: id,
        actorId: caller.id,
        reason: 'unsubmit',
        auditAction: 'quiz.version.snapshot',
      });
    } catch {
      // best-effort
    }

    const { data: after, error } = await admin
      .from('challenges')
      .update({ quiz_workflow_status: 'DRAFT', submitted_at: null })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.unsubmit',
      entity_type: 'quiz',
      entity_id: id,
      before_json: before,
      after_json: after,
    });

    return res.status(200).json({ success: true, quiz: after });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

