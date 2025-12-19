import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);

const toIsoStart = (d) => new Date(`${d}T00:00:00.000Z`).toISOString();
const toIsoEnd = (d) => new Date(`${d}T23:59:59.999Z`).toISOString();
const GUEST_TEAM_ID = 'CONVIDADOS';

const normalizeChas = (raw) => {
  const c = String(raw || 'C')
    .trim()
    .toUpperCase();
  return c === 'C' || c === 'H' || c === 'A' || c === 'S' ? c : 'C';
};

const CHAS_LABEL = {
  C: 'Conhecimento',
  H: 'Habilidade',
  A: 'Atitude',
  S: 'Segurança',
};

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
    const includeGuests = getStrParam(req, 'includeGuests') === '1';

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
    // Observação: is_leader pode ser NULL; tratamos NULL como "não líder".
    let usersQuery = admin.from('profiles').select('id, name, team_id, is_leader');
    if (normalizedScope === 'team') usersQuery = usersQuery.eq('team_id', effectiveScopeId);
    if (normalizedScope === 'coord') usersQuery = usersQuery.eq('coord_id', effectiveScopeId);
    if (normalizedScope === 'division') usersQuery = usersQuery.eq('division_id', effectiveScopeId);
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
    const userIds = eligibleProfiles.map((u) => u.id);

    if (userIds.length === 0) {
      return res.status(200).json({
        from,
        to,
        scope: normalizedScope,
        scopeId: effectiveScopeId || null,
        includeLeaders,
        includeGuests,
        eligibleUsers: 0,
        participants: 0,
        participationRate: 0,
        quizzes: [],
        themes: [],
        users: [],
      });
    }

    const fromIso = toIsoStart(from);
    const toIso = toIsoEnd(to);

    // 2) Buscar tentativas concluídas dentro do período (por lotes, para respeitar limite do IN)
    const attempts = [];
    for (const ids of chunk(userIds, 500)) {
      const { data: rows, error } = await admin
        .from('quiz_attempts')
        .select('user_id, challenge_id, submitted_at')
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

    const challengeIds = Array.from(new Set(attempts.map((a) => String(a.challenge_id)).filter(Boolean)));
    const quizzesMeta = new Map();
    if (challengeIds.length) {
      let chRows = [];
      try {
        const resp = await admin
          .from('challenges')
          .select('id, title, type, chas_dimension, quiz_specialties')
          .in('id', challengeIds);
        if (resp.error && /chas_dimension|quiz_specialties/i.test(String(resp.error.message || resp.error))) {
          const fallback = await admin.from('challenges').select('id, title, type').in('id', challengeIds);
          chRows = fallback.data || [];
        } else {
          chRows = resp.data || [];
        }
      } catch {
        chRows = [];
      }
      for (const c of chRows || []) {
        if (String(c.type || '') !== 'quiz') continue;
        quizzesMeta.set(String(c.id), {
          title: String(c.title || 'Quiz'),
          chas_dimension: normalizeChas(c.chas_dimension),
          quiz_specialties: Array.isArray(c.quiz_specialties) ? c.quiz_specialties.map((s) => String(s || '').trim()).filter(Boolean) : null,
        });
      }
    }

    const quizIds = Array.from(quizzesMeta.keys());
    if (quizIds.length === 0) {
      return res.status(200).json({
        from,
        to,
        scope: normalizedScope,
        scopeId: effectiveScopeId || null,
        includeLeaders,
        includeGuests,
        eligibleUsers: userIds.length,
        participants: 0,
        participationRate: 0,
        quizzes: [],
        themes: [],
        users: eligibleProfiles.map((u) => ({
          user_id: u.id,
          name: u.name,
          team_id: u.team_id,
          is_leader: u.is_leader,
          completedQuizzes: 0,
          avgScorePct: null,
          byChas: {},
        })),
      });
    }

    // 3) Contar perguntas por quiz (para calcular % de acerto)
    const questionCounts = new Map(); // challenge_id -> totalQuestions
    for (const ids of chunk(quizIds, 500)) {
      const { data: qRows, error } = await admin.from('quiz_questions').select('challenge_id').in('challenge_id', ids).limit(20000);
      if (error) break;
      for (const r of qRows || []) {
        const cid = String(r.challenge_id || '');
        if (!cid) continue;
        questionCounts.set(cid, (questionCounts.get(cid) || 0) + 1);
      }
    }

    // 4) Contar respostas/certos por usuário+quiz (independente do answered_at, pois o corte do período é pela submitted_at)
    const answerStats = new Map(); // `${user_id}:${challenge_id}` -> { answeredCount, correctCount }
    const attemptUserIds = Array.from(new Set(attempts.map((a) => String(a.user_id)).filter(Boolean)));
    for (const ids of chunk(attemptUserIds, 300)) {
      const { data: aRows, error } = await admin
        .from('user_quiz_answers')
        .select('user_id, challenge_id, is_correct')
        .in('user_id', ids)
        .in('challenge_id', quizIds)
        .limit(50000);
      if (error) break;
      for (const a of aRows || []) {
        const uid = String(a.user_id || '');
        const cid = String(a.challenge_id || '');
        if (!uid || !cid) continue;
        const key = `${uid}:${cid}`;
        const row = answerStats.get(key) || { answeredCount: 0, correctCount: 0 };
        row.answeredCount += 1;
        if (a.is_correct) row.correctCount += 1;
        answerStats.set(key, row);
      }
    }

    // 5) Agregar por quiz / por tema / por usuário
    const byQuiz = new Map(); // challenge_id -> aggregate
    const byChas = new Map(); // chas -> aggregate
    const byUser = new Map(); // user_id -> aggregate

    for (const a of attempts) {
      const uid = String(a.user_id || '');
      const cid = String(a.challenge_id || '');
      if (!uid || !cid) continue;
      const meta = quizzesMeta.get(cid);
      if (!meta) continue;

      const chas = normalizeChas(meta.chas_dimension);
      const totalQuestions = questionCounts.get(cid) || 0;
      const key = `${uid}:${cid}`;
      const stat = answerStats.get(key) || { answeredCount: 0, correctCount: 0 };
      const correctCount = stat.correctCount;

      // per quiz
      const q = byQuiz.get(cid) || {
        challenge_id: cid,
        title: meta.title,
        chas_dimension: chas,
        quiz_specialties: meta.quiz_specialties,
        participants: new Set(),
        attempts: 0,
        correctSum: 0,
        totalQuestionsSum: 0,
      };
      q.participants.add(uid);
      q.attempts += 1;
      q.correctSum += correctCount;
      q.totalQuestionsSum += totalQuestions;
      byQuiz.set(cid, q);

      // per chas
      const t = byChas.get(chas) || {
        chas,
        label: CHAS_LABEL[chas] || chas,
        quizzes: new Set(),
        participants: new Set(),
        attempts: 0,
        correctSum: 0,
        totalQuestionsSum: 0,
      };
      t.quizzes.add(cid);
      t.participants.add(uid);
      t.attempts += 1;
      t.correctSum += correctCount;
      t.totalQuestionsSum += totalQuestions;
      byChas.set(chas, t);

      // per user
      const u = byUser.get(uid) || {
        user_id: uid,
        completedQuizzes: 0,
        correctSum: 0,
        totalQuestionsSum: 0,
        byChas: {},
      };
      u.completedQuizzes += 1;
      u.correctSum += correctCount;
      u.totalQuestionsSum += totalQuestions;
      u.byChas[chas] = u.byChas[chas] || { completedQuizzes: 0, correctSum: 0, totalQuestionsSum: 0 };
      u.byChas[chas].completedQuizzes += 1;
      u.byChas[chas].correctSum += correctCount;
      u.byChas[chas].totalQuestionsSum += totalQuestions;
      byUser.set(uid, u);
    }

    const quizzes = Array.from(byQuiz.values())
      .map((q) => {
        const participants = q.participants.size;
        const avgScorePct =
          q.totalQuestionsSum > 0 ? Math.round((q.correctSum / q.totalQuestionsSum) * 1000) / 10 : null;
        return {
          challenge_id: q.challenge_id,
          title: q.title,
          chas_dimension: q.chas_dimension,
          quiz_specialties: q.quiz_specialties,
          participants,
          attempts: q.attempts,
          avgScorePct,
        };
      })
      .sort((a, b) => (b.participants || 0) - (a.participants || 0));

    const themes = Array.from(byChas.values())
      .map((t) => {
        const participants = t.participants.size;
        const avgScorePct =
          t.totalQuestionsSum > 0 ? Math.round((t.correctSum / t.totalQuestionsSum) * 1000) / 10 : null;
        const participationRate = userIds.length > 0 ? Math.round((participants / userIds.length) * 1000) / 10 : 0;
        return {
          chas: t.chas,
          label: t.label,
          quizzes: t.quizzes.size,
          participants,
          participationRate,
          avgScorePct,
        };
      })
      .sort((a, b) => String(a.chas).localeCompare(String(b.chas)));

    const users = eligibleProfiles
      .map((p) => {
        const u = byUser.get(p.id) || { completedQuizzes: 0, correctSum: 0, totalQuestionsSum: 0, byChas: {} };
        const avgScorePct =
          u.totalQuestionsSum > 0 ? Math.round((u.correctSum / u.totalQuestionsSum) * 1000) / 10 : null;
        const byChasOut = {};
        for (const k of Object.keys(CHAS_LABEL)) {
          const stat = u.byChas?.[k] || { completedQuizzes: 0, correctSum: 0, totalQuestionsSum: 0 };
          byChasOut[k] = {
            completedQuizzes: stat.completedQuizzes,
            avgScorePct:
              stat.totalQuestionsSum > 0 ? Math.round((stat.correctSum / stat.totalQuestionsSum) * 1000) / 10 : null,
          };
        }
        return {
          user_id: p.id,
          name: p.name,
          team_id: p.team_id,
          is_leader: p.is_leader,
          completedQuizzes: u.completedQuizzes,
          avgScorePct,
          byChas: byChasOut,
        };
      })
      .sort((a, b) => (b.completedQuizzes || 0) - (a.completedQuizzes || 0) || String(a.name).localeCompare(String(b.name)));

    const participantsSet = new Set(attemptUserIds);

    const eligibleUsers = userIds.length;
    const participants = participantsSet.size;
    const participationRate = eligibleUsers > 0 ? Math.round((participants / eligibleUsers) * 1000) / 10 : 0;

    return res.status(200).json({
      from,
      to,
      scope: normalizedScope,
      scopeId: effectiveScopeId || null,
      includeLeaders,
      includeGuests,
      eligibleUsers,
      participants,
      participationRate,
      quizzes,
      themes,
      users,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
