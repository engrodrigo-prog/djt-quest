import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);

    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const isCurator = canCurate({ roleSet, profile: callerProfile });
    const mineOnly = String(req.query?.mine || '').toLowerCase() === 'true';
    const status = req.query?.status ? String(req.query.status) : null;

    let q = admin
      .from('challenges')
      .select(
        'id, title, description, created_at, created_by, owner_id, quiz_workflow_status, submitted_at, approved_at, approved_by, published_at, published_by',
      )
      .eq('type', 'quiz')
      .order('created_at', { ascending: false })
      .limit(200);

    if (!isCurator || mineOnly) {
      q = q.or(`owner_id.eq.${caller.id},created_by.eq.${caller.id}`);
    }

    if (status) {
      q = q.eq('quiz_workflow_status', status);
    }

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ success: true, quizzes: data || [], canCurate: isCurator });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
