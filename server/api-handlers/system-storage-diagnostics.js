import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canManageUsers, ROLE } from '../lib/rbac.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', caller.id),
      admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);

    const isLeaderFlag = Boolean(callerProfile?.is_leader) || roleSet.has(ROLE.TEAM_LEADER);
    const hasPermission = canManageUsers({ roleSet, profile: callerProfile }) || isLeaderFlag;
    if (!hasPermission) return res.status(403).json({ error: 'Sem permissão' });

    const { data, error } = await admin.rpc('system_storage_diagnostics');
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true, diagnostics: data || null });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };

