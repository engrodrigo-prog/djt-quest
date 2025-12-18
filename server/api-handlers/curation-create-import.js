import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canCurate({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

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
      action: 'import.create',
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
