import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canAccessStudio } from '../lib/rbac.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);
    const uid = caller.id;

    const body = req.body || {};
    const ids = Array.isArray(body?.ids) ? body.ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (!ids.length) return res.status(200).json({ items: [] });

    // Authorization: anyone with Studio access can view thumbnails in the management list.
    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', uid);
    const roleSet = rolesToSet(rolesRows || []);
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('studio_access,is_leader')
      .eq('id', uid)
      .maybeSingle();
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Insufficient permissions' });

    const { data: rows, error } = await admin
      .from('profiles')
      .select('id, avatar_url, avatar_thumbnail_url')
      .in('id', ids);

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ items: rows || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
