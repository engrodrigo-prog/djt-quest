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
      action: 'compendium.import.finalize',
      entity_type: 'content_import',
      entity_id: id,
      before_json: { status: imp.status },
      after_json: { status: updated.status, kind: final?.kind || null },
    });

    return res.status(200).json({ success: true, import: updated });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

