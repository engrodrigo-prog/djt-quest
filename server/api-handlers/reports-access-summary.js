import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const toIsoStart = (d) => new Date(`${d}T00:00:00.000Z`).toISOString();
const toIsoEnd = (d) => new Date(`${d}T23:59:59.999Z`).toISOString();
const GUEST_TEAM_ID = 'CONVIDADOS';

function getDateParam(req, key) {
  const v = req.query?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const txt = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txt)) return null;
  return txt;
}

function getStrParam(req, key) {
  const v = req.query?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s != null ? String(s).trim() : '';
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const isStaff = Array.from(roleSet).some((r) => STAFF_ROLES.has(r));

    const { data: profile } = await admin
      .from('profiles')
      .select('id, team_id, coord_id, division_id')
      .eq('id', caller.id)
      .maybeSingle();

    const from = getDateParam(req, 'from') || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const to = getDateParam(req, 'to') || new Date().toISOString().slice(0, 10);
    const scope = getStrParam(req, 'scope') || 'team';
    const scopeId = getStrParam(req, 'scopeId');
    const includeLeaders = getStrParam(req, 'includeLeaders') === '1';
    const includeGuests = getStrParam(req, 'includeGuests') === '1';

    const allowedScopeIds = new Set([profile?.team_id, profile?.coord_id, profile?.division_id].filter(Boolean));
    const normalizedScope =
      scope === 'team' || scope === 'coord' || scope === 'division' || scope === 'all' ? scope : 'team';

    if (normalizedScope === 'all' && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    const effectiveScopeId =
      normalizedScope === 'team'
        ? scopeId || profile?.team_id || ''
        : normalizedScope === 'coord'
        ? scopeId || profile?.coord_id || ''
        : normalizedScope === 'division'
        ? scopeId || profile?.division_id || ''
        : '';

    if (normalizedScope !== 'all' && !effectiveScopeId) {
      return res.status(400).json({ error: 'scopeId required for this scope' });
    }
    if (!isStaff && normalizedScope !== 'team') {
      if (!allowedScopeIds.has(effectiveScopeId)) return res.status(403).json({ error: 'Forbidden' });
    }

    let usersQuery = admin.from('profiles').select('id, team_id, is_leader');
    if (normalizedScope === 'team') usersQuery = usersQuery.eq('team_id', effectiveScopeId);
    if (normalizedScope === 'coord') usersQuery = usersQuery.eq('coord_id', effectiveScopeId);
    if (normalizedScope === 'division') usersQuery = usersQuery.eq('division_id', effectiveScopeId);
    usersQuery = usersQuery.range(0, 9999);
    const { data: usersRaw, error: usersErr } = await usersQuery;
    if (usersErr) return res.status(400).json({ error: usersErr.message });
    const userIds = (usersRaw || [])
      .filter((u) => (includeLeaders ? true : Boolean(u?.is_leader) !== true))
      .filter((u) => {
        if (includeGuests) return true;
        const team = String(u?.team_id || '').trim().toUpperCase();
        return team !== GUEST_TEAM_ID;
      })
      .map((u) => u.id);

    const fromIso = toIsoStart(from);
    const toIso = toIsoEnd(to);

    const byDay = new Map(); // yyyy-mm-dd -> count
    const lastSeen = new Map(); // user_id -> ts
    let totalEvents = 0;

    for (const ids of chunk(userIds, 500)) {
      const { data: rows, error } = await admin
        .from('audit_log')
        .select('actor_id, action, created_at')
        .in('actor_id', ids)
        .like('action', 'access.%')
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: true })
        .limit(10000);

      if (error) {
        // audit_log pode não existir em alguns ambientes
        return res.status(200).json({
          from,
          to,
        scope: normalizedScope,
        scopeId: effectiveScopeId || null,
        includeLeaders,
        includeGuests,
        eligibleUsers: userIds.length,
        totalEvents: 0,
        daily: [],
        lastSeen: [],
      });
      }

      for (const r of rows || []) {
        totalEvents += 1;
        const day = String(r.created_at || '').slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + 1);
        const prev = lastSeen.get(r.actor_id);
        const ts = String(r.created_at || '');
        if (!prev || ts > prev) lastSeen.set(r.actor_id, ts);
      }
    }

    const daily = Array.from(byDay.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));

    const lastSeenList = Array.from(lastSeen.entries())
      .map(([user_id, last_seen_at]) => ({ user_id, last_seen_at }))
      .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1))
      .slice(0, 200);

    return res.status(200).json({
      from,
      to,
      scope: normalizedScope,
      scopeId: effectiveScopeId || null,
      includeLeaders,
      includeGuests,
      eligibleUsers: userIds.length,
      totalEvents,
      daily,
      lastSeen: lastSeenList,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
