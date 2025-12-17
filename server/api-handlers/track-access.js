import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

const allowedKinds = new Set(['login', 'session', 'pageview']);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const body = req.body || {};
    const kind = String(body.kind || 'session').trim().toLowerCase();
    const path = body.path != null ? String(body.path).slice(0, 500) : null;

    if (!allowedKinds.has(kind)) return res.status(400).json({ error: 'Invalid kind' });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: `access.${kind}`,
      entity_type: 'access',
      entity_id: caller.id,
      before_json: null,
      after_json: { path },
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true });
  }
}

export const config = { api: { bodyParser: true } };

