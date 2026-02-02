import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canAccessStudio, canCurate } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { challengeId, metrics } = req.body || {};
    const id = String(challengeId || '').trim();
    if (!id) return res.status(400).json({ error: 'challengeId required' });

    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', caller.id),
      admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });
    const isCurator = canCurate({ roleSet, profile: callerProfile });

    const { data: quiz, error: chErr } = await admin
      .from('challenges')
      .select('id, type, owner_id, created_by')
      .eq('id', id)
      .maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (String(quiz.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const isOwner = String(quiz.owner_id || '') === caller.id || String(quiz.created_by || '') === caller.id;
    if (!isOwner && !isCurator) return res.status(403).json({ error: 'Forbidden' });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.import.metrics',
      entity_type: 'quiz',
      entity_id: id,
      before_json: null,
      after_json: metrics || null,
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

