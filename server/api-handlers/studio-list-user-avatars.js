import { createClient } from '@supabase/supabase-js';
import { STUDIO_ALLOWED_ROLES, rolesToSet } from '../../shared/rbac.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.slice(7);

    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const body = req.body || {};
    const ids = Array.isArray(body?.ids) ? body.ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (!ids.length) return res.status(200).json({ items: [] });

    // Authorization: Studio roles or studio_access.
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid);
    const set = rolesToSet(roles || []);
    const allowedSet = new Set(STUDIO_ALLOWED_ROLES.map((r) => String(r || '').trim()).filter(Boolean));
    const hasStudioRole = Array.from(set).some((r) => allowedSet.has(r));

    let hasStudioAccessFlag = false;
    try {
      const { data: prof } = await admin.from('profiles').select('studio_access').eq('id', uid).maybeSingle();
      hasStudioAccessFlag = Boolean(prof?.studio_access);
    } catch {
      // ignore
    }

    if (!hasStudioRole && !hasStudioAccessFlag) return res.status(403).json({ error: 'Insufficient permissions' });

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

