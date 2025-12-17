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
    if (!canCurate(roleSet)) return res.status(403).json({ error: 'Forbidden' });

    const { importId, final } = req.body || {};
    const id = String(importId || '').trim();
    if (!id) return res.status(400).json({ error: 'importId required' });
    if (!final) return res.status(400).json({ error: 'final required' });

    const { data: imp, error: impErr } = await admin.from('content_imports').select('*').eq('id', id).maybeSingle();
    if (impErr) return res.status(400).json({ error: impErr.message });
    if (!imp) return res.status(404).json({ error: 'Import not found' });

    const { data: updated, error } = await admin
      .from('content_imports')
      .update({ status: 'FINAL_APPROVED', final_approved: final })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'import.finalize',
      entity_type: 'content_import',
      entity_id: id,
      before_json: { status: imp.status },
      after_json: { status: updated.status },
    });

    return res.status(200).json({ success: true, import: updated });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

