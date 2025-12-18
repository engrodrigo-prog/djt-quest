import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const body = req.body || {};
    const challengeId = String(body.challengeId || '').trim();
    if (!challengeId) return res.status(400).json({ error: 'challengeId required' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);

    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });
    const isCurator = canCurate({ roleSet, profile: callerProfile });

    const { data: before, error: chErr } = await admin
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!before) return res.status(404).json({ error: 'Quiz not found' });
    if (String(before.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const isOwner = String(before.owner_id || '') === caller.id || String(before.created_by || '') === caller.id;
    const workflow = String(before.quiz_workflow_status || 'PUBLISHED');

    const updates = {};
    if (typeof body.title === 'string') updates.title = body.title.trim();
    if (typeof body.description !== 'undefined') updates.description = body.description ? String(body.description) : null;
    if (typeof body.quiz_specialties !== 'undefined') updates.quiz_specialties = body.quiz_specialties || null;
    if (typeof body.chas_dimension === 'string') updates.chas_dimension = body.chas_dimension;

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No updates' });

    // Permissions + versioning
    if (workflow === 'DRAFT') {
      if (!isOwner && !isCurator) return res.status(403).json({ error: 'Forbidden' });
    } else if (workflow === 'REJECTED') {
      if (!isOwner) return res.status(403).json({ error: 'Forbidden' });
      // Start a new draft iteration (and snapshot the last submitted version)
      try {
        await snapshotQuizVersion(admin, {
          challengeId,
          actorId: caller.id,
          reason: 'edit:REJECTED',
          auditAction: 'quiz.version.snapshot',
        });
      } catch {
        // best-effort
      }
      updates.quiz_workflow_status = 'DRAFT';
      updates.approved_at = null;
      updates.approved_by = null;
    } else {
      // SUBMITTED/APPROVED/PUBLISHED: only curator/admin can edit, and we snapshot first
      if (!isCurator) return res.status(403).json({ error: 'Forbidden' });
      try {
        await snapshotQuizVersion(admin, {
          challengeId,
          actorId: caller.id,
          reason: `edit:${workflow}`,
          auditAction: 'quiz.version.snapshot',
        });
      } catch {
        // If quiz_versions table not present yet, proceed without snapshot.
      }
    }

    const { data: after, error } = await admin
      .from('challenges')
      .update(updates)
      .eq('id', challengeId)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.update',
      entity_type: 'quiz',
      entity_id: challengeId,
      before_json: before,
      after_json: after,
    });

    return res.status(200).json({ success: true, quiz: after });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
