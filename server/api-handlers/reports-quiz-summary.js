import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);

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
      .select('id, team_id, coord_id, division_id, is_leader')
      .eq('id', caller.id)
      .maybeSingle();

    const from = getDateParam(req, 'from') || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const to = getDateParam(req, 'to') || new Date().toISOString().slice(0, 10);
    const includeLeaders = getStrParam(req, 'includeLeaders') === '1';

    const scope = getStrParam(req, 'scope') || 'team';
    const scopeId = getStrParam(req, 'scopeId');
    const allowedScopeIds = new Set([profile?.team_id, profile?.coord_id, profile?.division_id].filter(Boolean));

    const normalizedScope =
      scope === 'team' || scope === 'coord' || scope === 'division' || scope === 'all' ? scope : 'team';

    if (normalizedScope === 'all' && !isStaff) {
      return res.status(403).json({ error: 'Forbidden' });
    }

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
      // Líderes: restringe ao que o perfil possui
      if (!allowedScopeIds.has(effectiveScopeId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // 1) Carregar usuários elegíveis (para participação/aderência)
    let usersQuery = admin.from('profiles').select('id');
    if (!includeLeaders) usersQuery = usersQuery.eq('is_leader', false);

    if (normalizedScope === 'team') usersQuery = usersQuery.eq('team_id', effectiveScopeId);
    if (normalizedScope === 'coord') usersQuery = usersQuery.eq('coord_id', effectiveScopeId);
    if (normalizedScope === 'division') usersQuery = usersQuery.eq('division_id', effectiveScopeId);

    const { data: users, error: usersErr } = await usersQuery;
    if (usersErr) return res.status(400).json({ error: usersErr.message });
    const userIds = (users || []).map((u) => u.id);

    if (userIds.length === 0) {
      return res.status(200).json({
        from,
        to,
        scope: normalizedScope,
        scopeId: effectiveScopeId || null,
        includeLeaders,
        eligibleUsers: 0,
        participants: 0,
        participationRate: 0,
        quizzes: [],
      });
    }

    const fromIso = toIsoStart(from);
    const toIso = toIsoEnd(to);

    // 2) Buscar tentativas concluídas dentro do período (por lotes, para respeitar limite do IN)
    const attempts = [];
    for (const ids of chunk(userIds, 500)) {
      const { data: rows, error } = await admin
        .from('quiz_attempts')
        .select('user_id, challenge_id, submitted_at, score, max_score')
        .in('user_id', ids)
        .not('submitted_at', 'is', null)
        .gte('submitted_at', fromIso)
        .lte('submitted_at', toIso)
        .limit(5000);
      if (error) {
        // Se quiz_attempts não existir em algum ambiente, cai para resposta vazia.
        break;
      }
      for (const r of rows || []) attempts.push(r);
    }

    const challengeIds = Array.from(new Set(attempts.map((a) => String(a.challenge_id))));
    const titles = new Map();
    if (challengeIds.length) {
      const { data: chRows } = await admin
        .from('challenges')
        .select('id, title, type')
        .in('id', challengeIds);
      for (const c of chRows || []) {
        if (String(c.type || '') !== 'quiz') continue;
        titles.set(String(c.id), String(c.title || 'Quiz'));
      }
    }

    const byQuiz = new Map();
    for (const a of attempts) {
      const cid = String(a.challenge_id);
      if (!titles.has(cid)) continue;
      const entry = byQuiz.get(cid) || {
        challenge_id: cid,
        title: titles.get(cid) || 'Quiz',
        participants: new Set(),
        attempts: 0,
        scoreSum: 0,
        maxSum: 0,
      };
      entry.participants.add(a.user_id);
      entry.attempts += 1;
      entry.scoreSum += Number(a.score || 0);
      entry.maxSum += Number(a.max_score || 0);
      byQuiz.set(cid, entry);
    }
    const participantsSet = new Set(Array.from(byQuiz.values()).flatMap((q) => Array.from(q.participants)));

    const quizzes = Array.from(byQuiz.values())
      .map((q) => {
        const participants = q.participants.size;
        const avgScorePct = q.maxSum > 0 ? Math.round((q.scoreSum / q.maxSum) * 1000) / 10 : null;
        return {
          challenge_id: q.challenge_id,
          title: q.title,
          participants,
          attempts: q.attempts,
          avgScorePct,
        };
      })
      .sort((a, b) => (b.participants || 0) - (a.participants || 0));

    const eligibleUsers = userIds.length;
    const participants = participantsSet.size;
    const participationRate = eligibleUsers > 0 ? Math.round((participants / eligibleUsers) * 1000) / 10 : 0;

    return res.status(200).json({
      from,
      to,
      scope: normalizedScope,
      scopeId: effectiveScopeId || null,
      includeLeaders,
      eligibleUsers,
      participants,
      participationRate,
      quizzes,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
