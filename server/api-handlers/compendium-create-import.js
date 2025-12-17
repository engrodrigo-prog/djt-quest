import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx', 'content_curator']);
const LEADER_ROLES = new Set(['lider_equipe']);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const body = req.body || {};
    const source_bucket = String(body.source_bucket || 'quiz-imports').trim();
    const source_path = String(body.source_path || '').trim();
    const source_mime = body.source_mime != null ? String(body.source_mime) : null;
    if (!source_path) return res.status(400).json({ error: 'source_path required' });

    const { data: created, error } = await admin
      .from('content_imports')
      .insert({ created_by: caller.id, source_bucket, source_path, source_mime, status: 'UPLOADED' })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'compendium.import.create',
      entity_type: 'content_import',
      entity_id: created.id,
      before_json: null,
      after_json: { source_bucket, source_path, source_mime },
    });

    return res.status(200).json({ success: true, import: created });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

