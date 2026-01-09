import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx', 'content_curator']);
const LEADER_ROLES = new Set(['lider_equipe']);

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

    const allowed =
      Boolean(profile?.studio_access) ||
      Boolean(profile?.is_leader) ||
      Array.from(roleSet).some((r) => STAFF_ROLES.has(r) || LEADER_ROLES.has(r));
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await admin
      .from('content_imports')
      .select('id, created_at, updated_at, created_by, source_bucket, source_path, source_mime, status, final_approved, ai_suggested')
      .eq('status', 'FINAL_APPROVED')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) return res.status(400).json({ error: error.message });

    const allowedKinds = new Set(['incident_report', 'study_material']);
    const items = (data || [])
      .filter((r) => allowedKinds.has(String(r?.final_approved?.kind || '')))
      .map((r) => ({
      id: r.id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      created_by: r.created_by,
      source_bucket: r.source_bucket,
      source_path: r.source_path,
      source_mime: r.source_mime,
      catalog: (r.final_approved && (r.final_approved.catalog || r.final_approved)) || null,
      final: r.final_approved || null,
    }));

    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
