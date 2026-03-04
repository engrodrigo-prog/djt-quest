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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    res.setHeader('Cache-Control', 'no-store');

    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const challengeId = getStrParam(req, 'challengeId');
    const targetUserId = getStrParam(req, 'targetUserId');
    if (!challengeId) return res.status(400).json({ error: 'challengeId required' });
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });

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
    const canUseGlobalScope = isStaff || Boolean(profile?.is_leader) || roleSet.has('lider_equipe');
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const scopeRaw = getStrParam(req, 'scope');
    const scope =
      scopeRaw === 'team' || scopeRaw === 'coord' || scopeRaw === 'division' || scopeRaw === 'all'
        ? scopeRaw
        : canUseGlobalScope
          ? 'all'
          : 'team';

    const scopeIdRaw = getStrParam(req, 'scopeId');
    const allowedScopeIds = new Set([profile?.team_id, profile?.coord_id, profile?.division_id].filter(Boolean));

    if (scope === 'all' && !canUseGlobalScope) return res.status(403).json({ error: 'Forbidden' });

    const effectiveScopeId =
      scope === 'team'
        ? scopeIdRaw || profile?.team_id || ''
        : scope === 'coord'
          ? scopeIdRaw || profile?.coord_id || ''
          : scope === 'division'
            ? scopeIdRaw || profile?.division_id || ''
            : '';

    if (scope !== 'all' && !effectiveScopeId) return res.status(400).json({ error: 'scopeId required for this scope' });
    if (!canUseGlobalScope && scope !== 'team') {
      if (!allowedScopeIds.has(effectiveScopeId)) return res.status(403).json({ error: 'Forbidden' });
    }
    if (!canUseGlobalScope && scope === 'team') {
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

    const targetProfile = eligibleProfiles.find((u) => u.id === targetUserId);
    if (!targetProfile) {
      return res.status(404).json({ error: 'Participante não encontrado no escopo atual' });
    }

    const { data: challenge, error: chErr } = await admin
      .from('challenges')
      .select('id, title, type')
      .eq('id', challengeId)
      .maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!challenge) return res.status(404).json({ error: 'Quiz não encontrado' });
    if (String(challenge.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const { data: questions, error: qErr } = await admin
      .from('quiz_questions')
      .select('id, question_text, order_index')
      .eq('challenge_id', challengeId)
      .order('order_index', { ascending: true });
    if (qErr) return res.status(400).json({ error: qErr.message });

    const questionIds = (questions || []).map((q) => String(q.id || '')).filter(Boolean);

    const optionsByQuestionId = new Map();
    if (questionIds.length) {
      const { data: optionRows, error: oErr } = await admin
        .from('quiz_options')
        .select('id, question_id, option_text, explanation, is_correct')
        .in('question_id', questionIds);
      if (oErr) return res.status(400).json({ error: oErr.message });

      for (const row of optionRows || []) {
        const qid = String(row?.question_id || '').trim();
        if (!qid) continue;
        if (!optionsByQuestionId.has(qid)) optionsByQuestionId.set(qid, []);
        optionsByQuestionId.get(qid).push({
          id: String(row?.id || ''),
          option_text: String(row?.option_text || ''),
          explanation: row?.explanation != null ? String(row.explanation) : null,
          is_correct: Boolean(row?.is_correct),
        });
      }
    }

    let answerQuery = admin
      .from('user_quiz_answers')
      .select('question_id, selected_option_id, is_correct, answered_at')
      .eq('challenge_id', challengeId)
      .eq('user_id', targetUserId)
      .order('answered_at', { ascending: false })
      .limit(10000);
    if (fromIso) answerQuery = answerQuery.gte('answered_at', fromIso);
    if (toIso) answerQuery = answerQuery.lte('answered_at', toIso);

    const { data: answers, error: aErr } = await answerQuery;
    if (aErr) return res.status(400).json({ error: aErr.message });

    const answersByQuestionId = new Map();
    for (const row of answers || []) {
      const qid = String(row?.question_id || '').trim();
      if (!qid || answersByQuestionId.has(qid)) continue;
      answersByQuestionId.set(qid, {
        question_id: qid,
        selected_option_id: row?.selected_option_id ? String(row.selected_option_id) : null,
        is_correct: row?.is_correct == null ? null : Boolean(row.is_correct),
        answered_at: row?.answered_at ? String(row.answered_at) : null,
      });
    }

    const questionPayload = (questions || []).map((q) => {
      const qid = String(q.id || '');
      const answer = answersByQuestionId.get(qid) || null;
      return {
        id: qid,
        question_text: String(q?.question_text || ''),
        order_index: q?.order_index ?? null,
        selected_option_id: answer?.selected_option_id || null,
        is_correct: answer?.is_correct ?? null,
        answered_at: answer?.answered_at || null,
        options: optionsByQuestionId.get(qid) || [],
      };
    });

    return res.status(200).json({
      challengeId,
      title: String(challenge?.title || 'Quiz'),
      user: targetProfile,
      scope,
      scopeId: scope === 'all' ? null : effectiveScopeId,
      includeLeaders,
      includeGuests,
      from,
      to,
      questions: questionPayload,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
