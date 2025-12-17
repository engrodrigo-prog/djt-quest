import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);
    const challengeId = String(req.query?.challengeId || '').trim();
    if (!challengeId) return res.status(400).json({ error: 'challengeId required' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const isCurator = canCurate(roleSet);

    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const { data: quiz } = await admin.from('challenges').select('id, type, owner_id, created_by').eq('id', challengeId).maybeSingle();
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (String(quiz.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const isOwner = String(quiz.owner_id || '') === caller.id || String(quiz.created_by || '') === caller.id;
    if (!isOwner && !isCurator) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await admin
      .from('quiz_versions')
      .select('id, challenge_id, version_number, created_at, created_by, reason')
      .eq('challenge_id', challengeId)
      .order('version_number', { ascending: false })
      .limit(50);
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ success: true, versions: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
