import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

const allowedKinds = new Set(['login', 'session', 'pageview']);
const RODRIGO_EMAIL = 'rodrigonasc@cpfl.com.br';

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

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

    try {
      const [rolesRes, profileRes] = await Promise.all([
        admin.from('user_roles').select('role').eq('user_id', caller.id),
        admin.from('profiles').select('name').eq('id', caller.id).maybeSingle(),
      ]);

      const isAdmin = (rolesRes.data || []).some((row) => String(row?.role || '') === 'admin');
      const profileName = normalize(profileRes.data?.name);
      const callerName = normalize(caller?.user_metadata?.name);
      const isRodrigoName = profileName === 'rodrigo nascimento' || callerName === 'rodrigo nascimento';
      const isRodrigoEmail = normalize(caller?.email) === RODRIGO_EMAIL;
      const isRodrigoAdmin = isAdmin && (isRodrigoName || isRodrigoEmail);

      if (!isRodrigoAdmin) {
        const day = new Date().toISOString().slice(0, 10);
        const awardKind = `access_${kind}`;
        const accessKey = `${kind}:${day}`;
        const { error: awardErr } = await admin.from('xp_awards').insert({
          user_id: caller.id,
          kind: awardKind,
          amount: 1, // 1 unit = 0.5 XP (converted in rankings breakdown).
          metadata: {
            awarded_xp: 0.5,
            access_key: accessKey,
            source: 'track-access',
            kind,
            path,
            day,
          },
        });

        if (awardErr) {
          const msg = String(awardErr.message || '');
          const isDuplicate = msg.toLowerCase().includes('duplicate key') || msg.toLowerCase().includes('unique');
          if (!isDuplicate) {
            console.warn('track-access: erro ao registrar XP de acesso', msg);
          }
        }
      }
    } catch (xpErr) {
      console.warn('track-access: falha não bloqueante ao aplicar XP de acesso', xpErr?.message || xpErr);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true });
  }
}

export const config = { api: { bodyParser: true } };
