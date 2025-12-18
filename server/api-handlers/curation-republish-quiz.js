import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';

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
    if (workflow !== 'PUBLISHED') {
      return res.status(400).json({ error: 'Quiz is not in PUBLISHED' });
    }

    // Snapshot at republish point (best-effort)
    try {
      await snapshotQuizVersion(admin, { challengeId: id, actorId: caller.id, reason: 'republish', auditAction: 'quiz.version.snapshot' });
    } catch {
      // ignore
    }

    const payload = {
      quiz_workflow_status: 'PUBLISHED',
      published_at: new Date().toISOString(),
      published_by: caller.id,
    };

    const { data: after, error } = await admin.from('challenges').update(payload).eq('id', id).select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.republish',
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

