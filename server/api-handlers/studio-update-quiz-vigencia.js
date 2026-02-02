import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canAccessStudio, isAdmin, isLeaderRole } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { challengeId, due_date } = req.body || {};
    const id = String(challengeId || '').trim();
    const due = String(due_date || '').trim();
    if (!id) return res.status(400).json({ error: 'challengeId required' });
    if (!isoDate(due)) return res.status(400).json({ error: 'due_date inválido (use AAAA-MM-DD)' });

    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', caller.id),
      admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const adminRole = isAdmin(roleSet);
    const leaderRole = isLeaderRole(roleSet) || Boolean(callerProfile?.is_leader);
    if (!adminRole && !leaderRole) return res.status(403).json({ error: 'Apenas líderes/admin podem ajustar vigência' });

    const { data: before, error: chErr } = await admin
      .from('challenges')
      .select('id, type, owner_id, created_by, due_date')
      .eq('id', id)
      .maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!before) return res.status(404).json({ error: 'Quiz not found' });
    if (String(before.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const isOwner = String(before.owner_id || '') === caller.id || String(before.created_by || '') === caller.id;
    if (!adminRole && !isOwner) {
      return res.status(403).json({ error: 'Você só pode alterar a vigência dos seus quizzes' });
    }

    const { data: after, error: upErr } = await admin
      .from('challenges')
      .update({ due_date: due })
      .eq('id', id)
      .select('id, due_date')
      .maybeSingle();
    if (upErr) return res.status(400).json({ error: upErr.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.vigencia.update',
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

