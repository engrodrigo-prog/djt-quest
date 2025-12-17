import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx', 'lider_equipe', 'content_curator']);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const { data: profile } = await admin
      .from('profiles')
      .select('studio_access, is_leader')
      .eq('id', caller.id)
      .maybeSingle();

    const allowed = Boolean(profile?.studio_access) || Boolean(profile?.is_leader) || Array.from(roleSet).some((r) => STAFF_ROLES.has(r));
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await admin
      .from('challenges')
      .select('id, title, created_at, quiz_workflow_status')
      .eq('type', 'quiz')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ quizzes: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
