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

    const challengeId = getStrParam(req, 'challengeId');
    if (!challengeId) return res.status(400).json({ error: 'challengeId required' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const isStaff = Array.from(roleSet).some((r) => STAFF_ROLES.has(r));

    const { data: profile } = await admin
      .from('profiles')
      .select('id, team_id, coord_id, division_id')
      .eq('id', caller.id)
      .maybeSingle();

    const from = getDateParam(req, 'from');
    const to = getDateParam(req, 'to');
    const includeLeaders = getStrParam(req, 'includeLeaders') === '1';
    const includeGuests = getStrParam(req, 'includeGuests') === '1';

    const scope = getStrParam(req, 'scope') || 'team';
    const scopeId = getStrParam(req, 'scopeId');
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

    const { data: questions, error: qErr } = await admin
      .from('quiz_questions')
      .select('id, question_text, created_at, order_index')
      .eq('challenge_id', challengeId)
      .order('order_index', { ascending: true });
    if (qErr) return res.status(400).json({ error: qErr.message });

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

    const counts = new Map();
    const fromIso = from ? toIsoStart(from) : null;
    const toIso = to ? toIsoEnd(to) : null;

    for (const ids of chunk(userIds, 500)) {
      let ansQuery = admin
        .from('user_quiz_answers')
        .select('question_id, is_correct, answered_at')
        .in('user_id', ids)
        .eq('challenge_id', challengeId)
        .limit(10000);
      if (fromIso) ansQuery = ansQuery.gte('answered_at', fromIso);
      if (toIso) ansQuery = ansQuery.lte('answered_at', toIso);

      const { data: answers, error: aErr } = await ansQuery;
      if (aErr) break;
      for (const a of answers || []) {
        const qid = String(a.question_id);
        const row = counts.get(qid) || { answeredCount: 0, correctCount: 0, lastAnsweredAt: null };
        row.answeredCount += 1;
        if (a.is_correct) row.correctCount += 1;
        const ts = a.answered_at ? String(a.answered_at) : null;
        if (ts && (!row.lastAnsweredAt || ts > row.lastAnsweredAt)) row.lastAnsweredAt = ts;
        counts.set(qid, row);
      }
    }

    const enriched = (questions || []).map((q) => {
      const stat = counts.get(String(q.id)) || { answeredCount: 0, correctCount: 0, lastAnsweredAt: null };
      const accuracyPct = stat.answeredCount > 0 ? Math.round((stat.correctCount / stat.answeredCount) * 1000) / 10 : null;
      return {
        id: q.id,
        question_text: q.question_text,
        created_at: q.created_at,
        order_index: q.order_index,
        answeredCount: stat.answeredCount,
        correctCount: stat.correctCount,
        accuracyPct,
        lastAnsweredAt: stat.lastAnsweredAt,
      };
    });

    const totalQuestions = enriched.length;
    const usedQuestions = enriched.filter((q) => q.answeredCount > 0).length;

    return res.status(200).json({
      challengeId,
      from: from || null,
      to: to || null,
      scope: normalizedScope,
      scopeId: effectiveScopeId || null,
      includeLeaders,
      includeGuests,
      totalQuestions,
      usedQuestions,
      unusedQuestions: totalQuestions - usedQuestions,
      questions: enriched,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
