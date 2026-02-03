import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const ALLOWED_ROLES = new Set(['lider_equipe', ...Array.from(STAFF_ROLES)]);
const GUEST_TEAM_ID = 'CONVIDADOS';

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

const toPct = (scoreRaw, maxRaw) => {
  const score = Number(scoreRaw) || 0;
  const max = Number(maxRaw) || 0;
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
  const pct = (score / max) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    res.setHeader('Cache-Control', 'no-store');

    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const challengeId = getStrParam(req, 'challengeId');
    if (!challengeId) return res.status(400).json({ error: 'challengeId required' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const isStaff = Array.from(roleSet).some((r) => STAFF_ROLES.has(r));

    const { data: profile } = await admin
      .from('profiles')
      .select('id, team_id, coord_id, division_id, is_leader, studio_access')
      .eq('id', caller.id)
      .maybeSingle();

    const isAllowedRole = Array.from(roleSet).some((r) => ALLOWED_ROLES.has(r));
    const allowed = Boolean(profile?.studio_access) || Boolean(profile?.is_leader) || isAllowedRole;
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    // Scope: staff can query all; leaders limited to their own scope.
    const scopeRaw = getStrParam(req, 'scope');
    const scope =
      scopeRaw === 'team' || scopeRaw === 'coord' || scopeRaw === 'division' || scopeRaw === 'all'
        ? scopeRaw
        : isStaff
          ? 'all'
          : 'team';

    const scopeIdRaw = getStrParam(req, 'scopeId');
    const allowedScopeIds = new Set([profile?.team_id, profile?.coord_id, profile?.division_id].filter(Boolean));

    if (scope === 'all' && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    const effectiveScopeId =
      scope === 'team'
        ? scopeIdRaw || profile?.team_id || ''
        : scope === 'coord'
          ? scopeIdRaw || profile?.coord_id || ''
          : scope === 'division'
            ? scopeIdRaw || profile?.division_id || ''
            : '';

    if (scope !== 'all' && !effectiveScopeId) return res.status(400).json({ error: 'scopeId required for this scope' });
    if (!isStaff && scope !== 'team') {
      if (!allowedScopeIds.has(effectiveScopeId)) return res.status(403).json({ error: 'Forbidden' });
    }
    if (!isStaff && scope === 'team') {
      const effectiveTeam = effectiveScopeId || '';
      if (effectiveTeam && profile?.team_id && String(profile.team_id) !== String(effectiveTeam)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const includeLeaders = getStrParam(req, 'includeLeaders') === '1';
    const includeGuests = getStrParam(req, 'includeGuests') === '1';
    const sort = getStrParam(req, 'sort') || 'score_desc'; // score_desc | submitted_desc | name_asc

    // Eligible users
    let usersQuery = admin.from('profiles').select('id, name, team_id, is_leader, coord_id, division_id');
    if (scope === 'team') usersQuery = usersQuery.eq('team_id', effectiveScopeId);
    if (scope === 'coord') usersQuery = usersQuery.eq('coord_id', effectiveScopeId);
    if (scope === 'division') usersQuery = usersQuery.eq('division_id', effectiveScopeId);
    usersQuery = usersQuery.range(0, 9999);

    const { data: usersRaw, error: usersErr } = await usersQuery;
    if (usersErr) return res.status(400).json({ error: usersErr.message });

    const eligibleProfiles = (usersRaw || [])
      .filter((u) => (includeLeaders ? true : Boolean(u?.is_leader) !== true))
      .filter((u) => {
        if (includeGuests) return true;
        const team = String(u?.team_id || '').trim().toUpperCase();
        return team !== GUEST_TEAM_ID;
      })
      .map((u) => ({
        id: String(u.id),
        name: String(u.name || ''),
        team_id: u.team_id != null ? String(u.team_id) : null,
        is_leader: Boolean(u.is_leader),
      }));

    const byUserId = new Map(eligibleProfiles.map((u) => [u.id, u]));
    const userIds = eligibleProfiles.map((u) => u.id);

    if (userIds.length === 0) {
      return res.status(200).json({
        challengeId,
        scope,
        scopeId: scope === 'all' ? null : effectiveScopeId,
        includeLeaders,
        includeGuests,
        eligibleUsers: 0,
        participants: 0,
        participationRate: 0,
        attempts: [],
      });
    }

    // Attempts for this quiz
    const attempts = [];
    for (const ids of chunk(userIds, 500)) {
      const { data: rows, error: aErr } = await admin
        .from('quiz_attempts')
        .select('user_id, submitted_at, score, max_score')
        .in('user_id', ids)
        .eq('challenge_id', challengeId)
        .not('submitted_at', 'is', null)
        .limit(5000);
      if (aErr) {
        const msg = String(aErr.message || '');
        if (/quiz_attempts/i.test(msg) && /(does not exist|schema cache|relation)/i.test(msg)) {
          return res.status(400).json({
            error: 'Tabela quiz_attempts não encontrada. Aplique a migração supabase/migrations/202511110945_quiz_attempts.sql.',
          });
        }
        return res.status(400).json({ error: msg || 'Falha ao carregar tentativas' });
      }
      for (const row of rows || []) {
        const uid = String(row?.user_id || '').trim();
        const prof = byUserId.get(uid);
        if (!uid || !prof) continue;
        attempts.push({
          user_id: uid,
          name: prof.name,
          team_id: prof.team_id,
          is_leader: prof.is_leader,
          submitted_at: row?.submitted_at ? String(row.submitted_at) : null,
          score: Number(row?.score ?? 0) || 0,
          max_score: Number(row?.max_score ?? 0) || 0,
          scorePct: toPct(row?.score, row?.max_score),
        });
      }
    }

    const participants = new Set(attempts.map((a) => a.user_id)).size;
    const participationRate = eligibleProfiles.length > 0 ? Math.round((participants / eligibleProfiles.length) * 1000) / 10 : 0;

    const compareName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    const compareSubmitted = (a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || ''), 'en');
    const compareScore = (a, b) => (Number(b.scorePct ?? -1) - Number(a.scorePct ?? -1)) || compareName(a, b);

    if (sort === 'submitted_desc') attempts.sort((a, b) => compareSubmitted(a, b) || compareScore(a, b));
    else if (sort === 'name_asc') attempts.sort(compareName);
    else attempts.sort(compareScore);

    return res.status(200).json({
      challengeId,
      scope,
      scopeId: scope === 'all' ? null : effectiveScopeId,
      includeLeaders,
      includeGuests,
      eligibleUsers: eligibleProfiles.length,
      participants,
      participationRate,
      attempts,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };

