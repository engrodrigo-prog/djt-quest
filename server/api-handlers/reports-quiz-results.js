import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const ALLOWED_ROLES = new Set(['lider_equipe', ...Array.from(STAFF_ROLES)]);

const GUEST_TEAM_ID = 'CONVIDADOS';
const EXTERNAL_TEAM_ID = 'EXTERNO';
const toIsoStart = (d) => new Date(`${d}T00:00:00.000Z`).toISOString();
const toIsoEnd = (d) => new Date(`${d}T23:59:59.999Z`).toISOString();

function getStrParam(req, key) {
  const v = req.query?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s != null ? String(s).trim() : '';
}

function getDateParam(req, key) {
  const v = req.query?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const txt = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txt)) return null;
  return txt;
}

const canonicalizeSiglaArea = (raw) => {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return s;
  if (s === 'DJT-PLA') return 'DJT-PLAN';
  if (s === 'DJTV-VOR') return 'DJTV-VOT';
  if (s === 'DJTB-STO') return 'DJTB-SAN';
  if (s === 'DJTV-ITP') return 'DJTV-ITA';
  return s;
};

const normalizeId = (raw) => {
  const s = canonicalizeSiglaArea(raw);
  return s ? s : null;
};

const deriveDivisionFromId = (raw) => {
  const s = normalizeId(raw);
  if (!s) return null;
  if (s === GUEST_TEAM_ID || s === EXTERNAL_TEAM_ID) return s;
  const base = s.split('-')[0];
  return base || s;
};

const deriveDivisionId = (p) => {
  const direct = normalizeId(p?.division_id);
  if (direct && direct !== GUEST_TEAM_ID && direct !== EXTERNAL_TEAM_ID) return direct;
  return (
    deriveDivisionFromId(p?.coord_id) ||
    deriveDivisionFromId(p?.team_id) ||
    deriveDivisionFromId(p?.sigla_area) ||
    null
  );
};

const deriveCoordId = (p) => {
  const direct = normalizeId(p?.coord_id);
  if (direct && direct !== GUEST_TEAM_ID && direct !== EXTERNAL_TEAM_ID) return direct;
  const fromTeam = normalizeId(p?.team_id);
  if (fromTeam && fromTeam.includes('-') && fromTeam !== GUEST_TEAM_ID && fromTeam !== EXTERNAL_TEAM_ID) return fromTeam;
  const fromSigla = normalizeId(p?.sigla_area);
  if (fromSigla && fromSigla.includes('-') && fromSigla !== GUEST_TEAM_ID && fromSigla !== EXTERNAL_TEAM_ID) return fromSigla;
  return null;
};

const toPct = (scoreRaw, maxRaw) => {
  const score = Number(scoreRaw) || 0;
  const max = Number(maxRaw) || 0;
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
  const pct = (score / max) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
};

const round1 = (n) => Math.round(n * 10) / 10;

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const ANSWERS_PAGE_SIZE = 10_000;

const isGuestValue = (raw) => {
  const s = String(raw || '').trim().toUpperCase();
  return s === GUEST_TEAM_ID || s === EXTERNAL_TEAM_ID;
};

const isGuestProfile = (p) =>
  isGuestValue(p?.team_id) || isGuestValue(p?.sigla_area) || isGuestValue(p?.operational_base);

const safeIso = (raw) => {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const inRange = (iso, fromIso, toIso) => {
  if (!iso) return false;
  const ms = Date.parse(String(iso));
  if (!Number.isFinite(ms)) return false;
  if (fromIso) {
    const fromMs = Date.parse(fromIso);
    if (Number.isFinite(fromMs) && ms < fromMs) return false;
  }
  if (toIso) {
    const toMs = Date.parse(toIso);
    if (Number.isFinite(toMs) && ms > toMs) return false;
  }
  return true;
};

async function getTotalQuestions(admin, challengeId) {
  const { count, error } = await admin
    .from('quiz_questions')
    .select('id', { count: 'exact', head: true })
    .eq('challenge_id', challengeId);
  if (error) return { totalQuestions: 0, error };
  const total = Math.max(0, Number(count ?? 0) || 0);
  return { totalQuestions: total, error: null };
}

async function loadAnswerStats(admin, challengeId, userIds) {
  const byUser = new Map(); // user_id -> { answered, correct, lastAnsweredAt }

  for (const ids of chunk(userIds, 500)) {
    let from = 0;
    while (true) {
      const { data: rows, error } = await admin
        .from('user_quiz_answers')
        .select('id, user_id, is_correct, answered_at')
        .in('user_id', ids)
        .eq('challenge_id', challengeId)
        .order('answered_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + ANSWERS_PAGE_SIZE - 1);
      if (error) return { byUser: new Map(), error };

      for (const row of rows || []) {
        const uid = String(row?.user_id || '').trim();
        if (!uid) continue;
        const existing = byUser.get(uid) || { answered: 0, correct: 0, lastAnsweredAt: null };
        existing.answered += 1;
        if (row?.is_correct === true) existing.correct += 1;
        const iso = safeIso(row?.answered_at);
        if (iso) {
          if (!existing.lastAnsweredAt || iso > existing.lastAnsweredAt) existing.lastAnsweredAt = iso;
        }
        byUser.set(uid, existing);
      }

      const got = (rows || []).length;
      if (got < ANSWERS_PAGE_SIZE) break;
      from += ANSWERS_PAGE_SIZE;
    }
  }

  return { byUser, error: null };
}

function ensureStat(map, key, init) {
  const k = key || '—';
  const existing = map.get(k);
  if (existing) return existing;
  const base = { eligibleUsers: 0, participants: 0, scoreSum: 0, maxSum: 0, ...init };
  map.set(k, base);
  return base;
}

function finalizeStats(rows) {
  return rows.map((r) => {
    const eligible = Number(r.eligibleUsers || 0) || 0;
    const participants = Number(r.participants || 0) || 0;
    const maxSum = Number(r.maxSum || 0) || 0;
    const scoreSum = Number(r.scoreSum || 0) || 0;
    const participationRate = eligible > 0 ? round1((participants / eligible) * 100) : 0;
    const avgScorePct = maxSum > 0 ? round1((scoreSum / maxSum) * 100) : null;
    return {
      ...r,
      eligibleUsers: eligible,
      participants,
      participationRate,
      avgScorePct,
    };
  });
}

const DIV_ORDER = ['DJT', 'DJTV', 'DJTB'];
const divisionOrderIndex = (id) => {
  const i = DIV_ORDER.indexOf(String(id || '').toUpperCase());
  return i === -1 ? 999 : i;
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
    const from = getDateParam(req, 'from');
    const to = getDateParam(req, 'to');
    const fromIso = from ? toIsoStart(from) : null;
    const toIso = to ? toIsoEnd(to) : null;

    let usersQuery = admin
      .from('profiles')
      .select('id, name, team_id, coord_id, division_id, sigla_area, operational_base, is_leader')
      .range(0, 9999);
    if (scope === 'team') usersQuery = usersQuery.eq('team_id', effectiveScopeId);
    if (scope === 'coord') usersQuery = usersQuery.eq('coord_id', effectiveScopeId);
    if (scope === 'division') usersQuery = usersQuery.eq('division_id', effectiveScopeId);

    const { data: usersRaw, error: usersErr } = await usersQuery;
    if (usersErr) return res.status(400).json({ error: usersErr.message });

    const eligibleProfiles = (usersRaw || [])
      .filter((u) => (includeLeaders ? true : Boolean(u?.is_leader) !== true))
      .filter((u) => (includeGuests ? true : !isGuestProfile(u)))
      .map((u) => ({
        id: String(u.id),
        name: String(u.name || ''),
        team_id: u.team_id != null ? normalizeId(u.team_id) : null,
        coord_id: u.coord_id != null ? normalizeId(u.coord_id) : null,
        division_id: u.division_id != null ? normalizeId(u.division_id) : null,
        sigla_area: u.sigla_area != null ? normalizeId(u.sigla_area) : null,
        operational_base: u.operational_base != null ? String(u.operational_base).trim() : null,
        is_leader: Boolean(u.is_leader),
      }));

    const byUserId = new Map(eligibleProfiles.map((u) => [u.id, u]));
    const userIds = eligibleProfiles.map((u) => u.id);

    const empty = {
      challengeId,
      scope,
      scopeId: scope === 'all' ? null : effectiveScopeId,
      includeLeaders,
      includeGuests,
      eligibleUsers: eligibleProfiles.length,
      participants: 0,
      participationRate: 0,
      avgScorePct: null,
      divisions: [],
      coordinations: [],
      teams: [],
      bases: [],
      people: [],
      attempts: [],
    };

    if (userIds.length === 0) return res.status(200).json(empty);

    const { totalQuestions, error: tqErr } = await getTotalQuestions(admin, challengeId);
    if (tqErr) return res.status(400).json({ error: tqErr.message || 'Falha ao contar perguntas' });

    // Submitted attempts (completion marker). We intentionally ignore score/max_score here because
    // older records stored XP instead of "acertos", which breaks accuracy averages.
    const submittedByUserId = new Map(); // user_id -> submitted_at
    for (const ids of chunk(userIds, 500)) {
      let q = admin
        .from('quiz_attempts')
        .select('user_id, submitted_at')
        .in('user_id', ids)
        .eq('challenge_id', challengeId)
        .not('submitted_at', 'is', null)
        .limit(5000);
      if (fromIso) q = q.gte('submitted_at', fromIso);
      if (toIso) q = q.lte('submitted_at', toIso);
      const { data: rows, error: aErr } = await q;
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
        const submittedAt = safeIso(row?.submitted_at);
        if (submittedAt) submittedByUserId.set(uid, submittedAt);
      }
    }

    const { byUser: answerStats, error: ansErr } = await loadAnswerStats(admin, challengeId, userIds);
    if (ansErr) return res.status(400).json({ error: ansErr.message || 'Falha ao carregar respostas' });

    const attempts = [];
    const attemptByUserId = new Map();

    for (const p of eligibleProfiles) {
      const uid = String(p.id);
      const submittedAt = submittedByUserId.get(uid) || null;
      const s = answerStats.get(uid) || { answered: 0, correct: 0, lastAnsweredAt: null };
      const completedByAnswers = totalQuestions > 0 && Number(s.answered || 0) >= totalQuestions;
      const completionAt = submittedAt || s.lastAnsweredAt || null;
      const hasAttempt = (Boolean(submittedAt) || completedByAnswers) && (fromIso || toIso ? inRange(completionAt, fromIso, toIso) : true);

      if (!hasAttempt) continue;

      const when = completionAt;
      const score = Math.max(0, Number(s.correct || 0) || 0);
      const max = Math.max(0, Number(totalQuestions || 0) || 0);
      const row = {
        user_id: uid,
        name: p.name,
        team_id: p.team_id,
        coord_id: p.coord_id,
        division_id: p.division_id,
        sigla_area: p.sigla_area,
        operational_base: p.operational_base,
        is_leader: p.is_leader,
        submitted_at: when,
        score,
        max_score: max,
        scorePct: toPct(score, max),
      };
      attempts.push(row);
      attemptByUserId.set(uid, row);
    }

    const participants = attempts.length;
    const participationRate =
      eligibleProfiles.length > 0 ? round1((participants / eligibleProfiles.length) * 100) : 0;

    const people = eligibleProfiles
      .map((p) => {
        const a = attemptByUserId.get(String(p.id));
        return {
          user_id: p.id,
          name: p.name,
          team_id: p.team_id,
          coord_id: p.coord_id,
          division_id: p.division_id,
          sigla_area: p.sigla_area,
          operational_base: p.operational_base,
          is_leader: p.is_leader,
          submitted_at: a?.submitted_at || null,
          score: typeof a?.score === 'number' ? a.score : null,
          max_score: typeof a?.max_score === 'number' ? a.max_score : null,
          scorePct: typeof a?.scorePct === 'number' ? a.scorePct : null,
          hasAttempt: Boolean(a),
        };
      })
      .sort(
        (a, b) =>
          Number(b.hasAttempt) - Number(a.hasAttempt) ||
          (Number(b.scorePct ?? -1) - Number(a.scorePct ?? -1)) ||
          String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'),
      );

    // Aggregations
    const byDivision = new Map();
    const byCoord = new Map();
    const byTeam = new Map();
    const byBase = new Map();

    const keysFor = (p) => {
      const divisionId = deriveDivisionId(p);
      const coordId = deriveCoordId(p);
      const teamId = normalizeId(p?.team_id) || null;
      const baseRaw = String(p?.operational_base || '').trim();
      const base = baseRaw && !isGuestValue(baseRaw) ? baseRaw : null;
      return { divisionId, coordId, teamId, base };
    };

    for (const p of eligibleProfiles) {
      const { divisionId, coordId, teamId, base } = keysFor(p);

      ensureStat(byDivision, divisionId, { division_id: divisionId }).eligibleUsers += 1;
      ensureStat(byCoord, coordId || '—', { coord_id: coordId, division_id: divisionId }).eligibleUsers += 1;
      ensureStat(byTeam, teamId || '—', { team_id: teamId, coord_id: coordId, division_id: divisionId }).eligibleUsers += 1;
      if (base) {
        const baseKey = `${coordId || '—'}::${base}`;
        ensureStat(byBase, baseKey, { base, coord_id: coordId, division_id: divisionId }).eligibleUsers += 1;
      }
    }

    let scoreSumAll = 0;
    let maxSumAll = 0;

    for (const a of attempts) {
      const prof = byUserId.get(String(a.user_id));
      const { divisionId, coordId, teamId, base } = keysFor(prof || a);

      const score = Number(a.score ?? 0) || 0;
      const max = Number(a.max_score ?? 0) || 0;
      scoreSumAll += score;
      maxSumAll += max;

      const d = ensureStat(byDivision, divisionId, { division_id: divisionId });
      d.participants += 1;
      d.scoreSum += score;
      d.maxSum += max;

      const c = ensureStat(byCoord, coordId || '—', { coord_id: coordId, division_id: divisionId });
      c.participants += 1;
      c.scoreSum += score;
      c.maxSum += max;

      const t = ensureStat(byTeam, teamId || '—', { team_id: teamId, coord_id: coordId, division_id: divisionId });
      t.participants += 1;
      t.scoreSum += score;
      t.maxSum += max;

      if (base) {
        const baseKey = `${coordId || '—'}::${base}`;
        const b = ensureStat(byBase, baseKey, { base, coord_id: coordId, division_id: divisionId });
        b.participants += 1;
        b.scoreSum += score;
        b.maxSum += max;
      }
    }

    const avgScorePct = maxSumAll > 0 ? round1((scoreSumAll / maxSumAll) * 100) : null;

    const divisions = finalizeStats(Array.from(byDivision.values()))
      .sort((a, b) => divisionOrderIndex(a.division_id) - divisionOrderIndex(b.division_id) || String(a.division_id || '').localeCompare(String(b.division_id || '')));
    const coordinations = finalizeStats(Array.from(byCoord.values()))
      .sort(
        (a, b) =>
          divisionOrderIndex(a.division_id) - divisionOrderIndex(b.division_id) ||
          String(a.coord_id || '').localeCompare(String(b.coord_id || '')),
      );
    const teams = finalizeStats(Array.from(byTeam.values()))
      .sort(
        (a, b) =>
          divisionOrderIndex(a.division_id) - divisionOrderIndex(b.division_id) ||
          String(a.team_id || '').localeCompare(String(b.team_id || '')),
      );
    const bases = finalizeStats(Array.from(byBase.values()))
      .sort(
        (a, b) =>
          divisionOrderIndex(a.division_id) - divisionOrderIndex(b.division_id) ||
          String(a.coord_id || '').localeCompare(String(b.coord_id || '')) ||
          String(a.base || '').localeCompare(String(b.base || '')),
      );

    // Friendly sort for attempts (best score first, then name)
    attempts.sort(
      (a, b) =>
        (Number(b.scorePct ?? -1) - Number(a.scorePct ?? -1)) ||
        String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'),
    );

    return res.status(200).json({
      challengeId,
      scope,
      scopeId: scope === 'all' ? null : effectiveScopeId,
      includeLeaders,
      includeGuests,
      eligibleUsers: eligibleProfiles.length,
      participants,
      participationRate,
      avgScorePct,
      divisions,
      coordinations,
      teams,
      bases,
      people,
      attempts,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
