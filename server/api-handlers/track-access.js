import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
import { isAllowlistedAdmin } from '../lib/admin-allowlist.js';

const allowedKinds = new Set(['daily', 'login', 'session', 'pageview']);
const ACCESS_TZ = 'America/Sao_Paulo';

function dayKeyInTimeZone(date = new Date(), timeZone = ACCESS_TZ) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    if (map.year && map.month && map.day) return `${map.year}-${map.month}-${map.day}`;
  } catch {
    // noop
  }
  // Fallback: UTC day key
  return new Date(date).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const body = req.body || {};
    const kind = String(body.kind || 'daily').trim().toLowerCase();
    const path = body.path != null ? String(body.path).slice(0, 500) : null;

    if (!allowedKinds.has(kind)) return res.status(400).json({ error: 'Invalid kind' });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: `access.${kind === 'daily' ? 'daily' : kind}`,
      entity_type: 'access',
      entity_id: caller.id,
      before_json: null,
      after_json: { path },
    });

    // Award: 1 XP per day if at least one access event exists.
    // Server-side dedupe is required because clients/devices can differ.
    if (!isAllowlistedAdmin({ email: caller.email })) {
      const dayKey = dayKeyInTimeZone(new Date(), ACCESS_TZ);
      const accessKey = `access_daily_${caller.id}_${dayKey}`;
      try {
        const { error: xpErr } = await admin.from('xp_awards').insert({
          user_id: caller.id,
          kind: 'access_daily',
          amount: 1,
          metadata: {
            access_key: accessKey,
            day: dayKey,
            tz: ACCESS_TZ,
            source: 'track-access',
            kind,
            path,
          },
        });

        // Ignore duplicate awards for the same day (unique index enforces this).
        if (xpErr && !String(xpErr.message || '').toLowerCase().includes('duplicate')) {
          console.warn('track-access: failed to insert access_daily award', xpErr.message || xpErr);
        }
      } catch {
        // best-effort
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true });
  }
}

export const config = { api: { bodyParser: true } };
