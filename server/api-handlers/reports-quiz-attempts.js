import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const ALLOWED_ROLES = new Set(['lider_equipe', ...Array.from(STAFF_ROLES)]);
const GUEST_TEAM_ID = 'CONVIDADOS';
const toIsoStart = (d) => new Date(`${d}T00:00:00.000Z`).toISOString();
const toIsoEnd = (d) => new Date(`${d}T23:59:59.999Z`).toISOString();

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
    const includeEligible = getStrParam(req, 'includeEligible') === '1';
    const from = getDateParam(req, 'from');
    const to = getDateParam(req, 'to');
    const fromIso = from ? toIsoStart(from) : null;
    const toIso = to ? toIsoEnd(to) : null;

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

    // Para evitar contagem "zerada" quando há respostas mas não há quiz_attempts.submitted_at,
    // calculamos participação e notas a partir de user_quiz_answers (acertos / total de perguntas).
    const { count: totalQuestionsRaw, error: tqErr } = await admin
      .from('quiz_questions')
      .select('id', { count: 'exact', head: true })
      .eq('challenge_id', challengeId);
    if (tqErr) {
      const msg = String(tqErr.message || '');
      if (/quiz_questions/i.test(msg) && /(does not exist|schema cache|relation)/i.test(msg)) {
        return res.status(400).json({
          error: 'Tabela quiz_questions não encontrada. Aplique as migrações de quiz (supabase/migrations/*quiz*).',
        });
      }
      return res.status(400).json({ error: msg || 'Falha ao carregar perguntas do quiz' });
    }
    const totalQuestions = Math.max(0, Number(totalQuestionsRaw ?? 0) || 0);

    const statsByUserId = new Map(); // user_id -> { answered:Set, correct:number, lastAnsweredAt:string|null }
    const safeChunkSize =
      totalQuestions > 0 ? Math.max(1, Math.min(500, Math.floor(9000 / totalQuestions))) : 500;

    for (const ids of chunk(userIds, safeChunkSize)) {
      let ansQuery = admin
        .from('user_quiz_answers')
        .select('user_id, question_id, is_correct, answered_at')
        .in('user_id', ids)
        .eq('challenge_id', challengeId)
        .limit(10000);
      if (fromIso) ansQuery = ansQuery.gte('answered_at', fromIso);
      if (toIso) ansQuery = ansQuery.lte('answered_at', toIso);

      const { data: answers, error: aErr } = await ansQuery;
      if (aErr) {
        const msg = String(aErr.message || '');
        if (/user_quiz_answers/i.test(msg) && /(does not exist|schema cache|relation)/i.test(msg)) {
          return res.status(400).json({
            error: 'Tabela user_quiz_answers não encontrada. Aplique as migrações de quiz (supabase/migrations/*quiz*).',
          });
        }
        return res.status(400).json({ error: msg || 'Falha ao carregar respostas' });
      }

      for (const row of answers || []) {
        const uid = String(row?.user_id || '').trim();
        const prof = byUserId.get(uid);
        if (!uid || !prof) continue;

        const qid = String(row?.question_id || '').trim();
        if (!qid) continue;

        const current = statsByUserId.get(uid) || { answered: new Set(), correct: 0, lastAnsweredAt: null };
        if (!current.answered.has(qid)) {
          current.answered.add(qid);
          if (row?.is_correct) current.correct += 1;
        }
        const ts = row?.answered_at ? String(row.answered_at) : null;
        if (ts && (!current.lastAnsweredAt || ts > current.lastAnsweredAt)) current.lastAnsweredAt = ts;
        statsByUserId.set(uid, current);
      }
    }

    const attempts = [];
    for (const [uid, stat] of statsByUserId.entries()) {
      const prof = byUserId.get(uid);
      if (!prof) continue;
      const score = Math.max(0, Number(stat?.correct ?? 0) || 0);
      const maxScore = totalQuestions;
      attempts.push({
        user_id: String(uid),
        name: prof.name,
        team_id: prof.team_id,
        is_leader: prof.is_leader,
        submitted_at: stat?.lastAnsweredAt ? String(stat.lastAnsweredAt) : null,
        score,
        max_score: maxScore,
        scorePct: toPct(score, maxScore),
      });
    }

    const participants = new Set(attempts.map((a) => a.user_id)).size;
    const participationRate = eligibleProfiles.length > 0 ? Math.round((participants / eligibleProfiles.length) * 1000) / 10 : 0;
    const scorePcts = attempts.map((a) => a.scorePct).filter((v) => typeof v === 'number');
    const avgScorePct =
      scorePcts.length > 0 ? Math.round((scorePcts.reduce((acc, v) => acc + v, 0) / scorePcts.length) * 10) / 10 : null;

    const compareName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    const compareSubmitted = (a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || ''), 'en');
    const compareScore = (a, b) => (Number(b.scorePct ?? -1) - Number(a.scorePct ?? -1)) || compareName(a, b);

    if (sort === 'submitted_desc') attempts.sort((a, b) => compareSubmitted(a, b) || compareScore(a, b));
    else if (sort === 'name_asc') attempts.sort(compareName);
    else attempts.sort(compareScore);

    return res.status(200).json({
      challengeId,
      from,
      to,
      scope,
      scopeId: scope === 'all' ? null : effectiveScopeId,
      includeLeaders,
      includeGuests,
      sort,
      eligibleUsers: eligibleProfiles.length,
      participants,
      participationRate,
      avgScorePct,
      attempts,
      ...(includeEligible ? { eligible: eligibleProfiles } : {}),
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
