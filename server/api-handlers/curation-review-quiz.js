import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const body = req.body || {};
    const challengeId = String(body.challengeId || '').trim();
    const decision = String(body.decision || '').trim().toUpperCase();
    const message = body.message != null ? String(body.message).trim() : '';

    if (!challengeId) return res.status(400).json({ error: 'challengeId required' });
    if (decision !== 'APPROVED' && decision !== 'REJECTED') return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
    if (decision === 'REJECTED' && message.length < 5) return res.status(400).json({ error: 'Mensagem obrigatória para reprovação' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canCurate({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const { data: before, error: chErr } = await admin.from('challenges').select('*').eq('id', challengeId).maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!before) return res.status(404).json({ error: 'Quiz not found' });
    if (String(before.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const workflow = String(before.quiz_workflow_status || 'PUBLISHED');
    if (workflow !== 'SUBMITTED') return res.status(400).json({ error: 'Quiz is not in SUBMITTED' });

    const updates =
      decision === 'APPROVED'
        ? { quiz_workflow_status: 'APPROVED', approved_at: new Date().toISOString(), approved_by: caller.id }
        : { quiz_workflow_status: 'REJECTED', approved_at: new Date().toISOString(), approved_by: caller.id };

    const { data: after, error } = await admin.from('challenges').update(updates).eq('id', challengeId).select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });

    // Optional feedback comment (best-effort: table may not exist in all envs)
    if (message) {
      try {
        await admin.from('quiz_curation_comments').insert({
          challenge_id: challengeId,
          author_id: caller.id,
          kind: 'decision',
          message,
        });
      } catch {
        // ignore
      }
    }

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: decision === 'APPROVED' ? 'quiz.review.approve' : 'quiz.review.reject',
      entity_type: 'quiz',
      entity_id: challengeId,
      before_json: before,
      after_json: { ...after, message: message || null },
    });

    return res.status(200).json({ success: true, quiz: after });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
