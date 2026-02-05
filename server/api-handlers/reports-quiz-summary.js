import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);

const toIsoStart = (d) => new Date(`${d}T00:00:00.000Z`).toISOString();
const toIsoEnd = (d) => new Date(`${d}T23:59:59.999Z`).toISOString();
const GUEST_TEAM_ID = 'CONVIDADOS';
const EXTERNAL_TEAM_ID = 'EXTERNO';
const ANSWERS_PAGE_SIZE = 10_000;
const QUESTIONS_PAGE_SIZE = 10_000;

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

const round1 = (n) => Math.round(n * 10) / 10;

const safeIso = (raw) => {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const isGuestValue = (raw) => {
  const s = String(raw || '').trim().toUpperCase();
  return s === GUEST_TEAM_ID || s === EXTERNAL_TEAM_ID;
};

const isGuestProfile = (p) =>
  isGuestValue(p?.team_id) || isGuestValue(p?.sigla_area) || isGuestValue(p?.operational_base);

async function loadQuizMeta(admin, challengeIds) {
  const quizzesMeta = new Map();
  if (!challengeIds.length) return quizzesMeta;
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
      quiz_specialties: Array.isArray(c.quiz_specialties)
        ? c.quiz_specialties.map((s) => String(s || '').trim()).filter(Boolean)
        : null,
    });
  }
  return quizzesMeta;
}

async function loadQuestionCounts(admin, quizIds) {
  const counts = new Map(); // challenge_id -> total questions
  for (const ids of chunk(quizIds, 200)) {
    let from = 0;
    while (true) {
      const { data: rows, error } = await admin
        .from('quiz_questions')
        .select('id, challenge_id')
        .in('challenge_id', ids)
        .order('challenge_id', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + QUESTIONS_PAGE_SIZE - 1);
      if (error) throw error;
      for (const row of rows || []) {
        const cid = String(row?.challenge_id || '').trim();
        if (!cid) continue;
        counts.set(cid, (counts.get(cid) || 0) + 1);
      }
      const got = (rows || []).length;
      if (got < QUESTIONS_PAGE_SIZE) break;
      from += QUESTIONS_PAGE_SIZE;
    }
  }
  return counts;
}

async function loadCorrectCounts(admin, quizIds, participantUserIds) {
  const correctByUserQuiz = new Map(); // `${user_id}:${challenge_id}` -> correct
  for (const uidChunk of chunk(participantUserIds, 500)) {
    for (const qChunk of chunk(quizIds, 80)) {
      let from = 0;
      while (true) {
        const { data: rows, error } = await admin
          .from('user_quiz_answers')
          .select('id, user_id, challenge_id, is_correct')
          .in('user_id', uidChunk)
          .in('challenge_id', qChunk)
          .order('challenge_id', { ascending: true })
          .order('user_id', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + ANSWERS_PAGE_SIZE - 1);
        if (error) throw error;
        for (const row of rows || []) {
          const uid = String(row?.user_id || '').trim();
          const cid = String(row?.challenge_id || '').trim();
          if (!uid || !cid) continue;
          if (row?.is_correct !== true) continue;
          const key = `${uid}:${cid}`;
          correctByUserQuiz.set(key, (correctByUserQuiz.get(key) || 0) + 1);
        }
        const got = (rows || []).length;
        if (got < ANSWERS_PAGE_SIZE) break;
        from += ANSWERS_PAGE_SIZE;
      }
    }
  }
  return correctByUserQuiz;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    res.setHeader('Cache-Control', 'no-store');

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
    let usersQuery = admin.from('profiles').select('id, name, team_id, sigla_area, operational_base, is_leader');
    if (normalizedScope === 'team') usersQuery = usersQuery.eq('team_id', effectiveScopeId);
    if (normalizedScope === 'coord') usersQuery = usersQuery.eq('coord_id', effectiveScopeId);
    if (normalizedScope === 'division') usersQuery = usersQuery.eq('division_id', effectiveScopeId);
    usersQuery = usersQuery.range(0, 9999);

    const { data: usersRaw, error: usersErr } = await usersQuery;
    if (usersErr) return res.status(400).json({ error: usersErr.message });
    const eligibleProfiles = (usersRaw || [])
      .filter((u) => (includeLeaders ? true : Boolean(u?.is_leader) !== true))
      .filter((u) => (includeGuests ? true : !isGuestProfile(u)))
      .map((u) => ({
        id: String(u.id),
        name: String(u.name || ''),
        team_id: u.team_id != null ? String(u.team_id) : null,
        sigla_area: u.sigla_area != null ? String(u.sigla_area) : null,
        operational_base: u.operational_base != null ? String(u.operational_base) : null,
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
    // Observação: usamos quiz_attempts.submitted_at como marcador de conclusão no período.
    // A nota (% acerto) é calculada por acertos/total de questões via user_quiz_answers (score/max_score pode ser XP em quizzes antigos).
    const attemptSubmittedAt = new Map(); // `${user_id}:${challenge_id}` -> submitted_at iso
    const participantsSet = new Set(); // user_id
    const challengeSet = new Set(); // challenge_id

    const userIdChunks = chunk(userIds, 400);
    const concurrency = 3;
    for (let i = 0; i < userIdChunks.length; i += concurrency) {
      const slice = userIdChunks.slice(i, i + concurrency);
      const results = await Promise.all(
        slice.map((ids) =>
          admin
            .from('quiz_attempts')
            .select('user_id, challenge_id, submitted_at')
            .in('user_id', ids)
            .not('submitted_at', 'is', null)
            .gte('submitted_at', fromIso)
            .lte('submitted_at', toIso)
            .limit(5000),
        ),
      );

      for (const r of results) {
        if (r?.error) {
          const msg = String(r.error.message || '');
          if (/quiz_attempts/i.test(msg) && /(does not exist|schema cache|relation)/i.test(msg)) {
            return res.status(400).json({
              error:
                'Tabela quiz_attempts não encontrada. Aplique a migração supabase/migrations/202511110945_quiz_attempts.sql.',
            });
          }
          return res.status(400).json({ error: msg || 'Falha ao carregar tentativas' });
        }

        for (const row of r.data || []) {
          const uid = String(row?.user_id || '').trim();
          const cid = String(row?.challenge_id || '').trim();
          if (!uid || !cid) continue;
          participantsSet.add(uid);
          challengeSet.add(cid);
          const submittedAt = safeIso(row?.submitted_at);
          if (submittedAt) attemptSubmittedAt.set(`${uid}:${cid}`, submittedAt);
        }
      }
    }

    const challengeIds = Array.from(challengeSet);
    const quizzesMeta = await loadQuizMeta(admin, challengeIds);

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
          byChas: { C: { completedQuizzes: 0, avgScorePct: null }, H: { completedQuizzes: 0, avgScorePct: null }, A: { completedQuizzes: 0, avgScorePct: null }, S: { completedQuizzes: 0, avgScorePct: null } },
        })),
      });
    }

    // 3) Nota = acertos / total de questões do quiz.
    const questionCounts = await loadQuestionCounts(admin, quizIds);
    const participantUserIds = Array.from(participantsSet);
    const correctCounts = await loadCorrectCounts(admin, quizIds, participantUserIds);

    const byQuiz = new Map(); // cid -> { attempts, scoreSum, maxSum }
    const byChas = new Map(); // chas -> { quizzes:Set, participants:Set, scoreSum, maxSum }
    const byUser = new Map(); // uid -> { completedQuizzes, scoreSum, maxSum, byChas: {chas:{completedQuizzes,scoreSum,maxSum}} }

    for (const key of attemptSubmittedAt.keys()) {
      const [uid, cid] = String(key).split(':');
      const meta = quizzesMeta.get(String(cid));
      if (!meta) continue;
      const max = Math.max(0, Number(questionCounts.get(String(cid)) || 0));
      if (max <= 0) continue;
      const score = Math.max(0, Number(correctCounts.get(`${uid}:${cid}`) || 0));

      const q = byQuiz.get(cid) || { attempts: 0, scoreSum: 0, maxSum: 0 };
      q.attempts += 1;
      q.scoreSum += score;
      q.maxSum += max;
      byQuiz.set(cid, q);

      const chas = normalizeChas(meta.chas_dimension);
      const t =
        byChas.get(chas) ||
        { chas, label: CHAS_LABEL[chas] || chas, quizzes: new Set(), participants: new Set(), scoreSum: 0, maxSum: 0 };
      t.quizzes.add(String(cid));
      t.participants.add(String(uid));
      t.scoreSum += score;
      t.maxSum += max;
      byChas.set(chas, t);

      const u = byUser.get(String(uid)) || { user_id: String(uid), completedQuizzes: 0, scoreSum: 0, maxSum: 0, byChas: {} };
      u.completedQuizzes += 1;
      u.scoreSum += score;
      u.maxSum += max;
      u.byChas[chas] = u.byChas[chas] || { completedQuizzes: 0, scoreSum: 0, maxSum: 0 };
      u.byChas[chas].completedQuizzes += 1;
      u.byChas[chas].scoreSum += score;
      u.byChas[chas].maxSum += max;
      byUser.set(String(uid), u);
    }

    const quizzes = quizIds
      .map((cid) => {
        const meta = quizzesMeta.get(cid);
        const agg = byQuiz.get(cid) || { attempts: 0, scoreSum: 0, maxSum: 0 };
        const avgScorePct = agg.maxSum > 0 ? round1((agg.scoreSum / agg.maxSum) * 100) : null;
        return {
          challenge_id: cid,
          title: meta.title,
          chas_dimension: normalizeChas(meta.chas_dimension),
          quiz_specialties: meta.quiz_specialties,
          participants: agg.attempts,
          attempts: agg.attempts,
          avgScorePct,
        };
      })
      .sort((a, b) => (b.participants || 0) - (a.participants || 0));

    const themes = Array.from(byChas.values())
      .map((t) => {
        const participants = t.participants.size;
        const avgScorePct = t.maxSum > 0 ? round1((t.scoreSum / t.maxSum) * 100) : null;
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
        const u = byUser.get(p.id) || { completedQuizzes: 0, scoreSum: 0, maxSum: 0, byChas: {} };
        const avgScorePct = u.maxSum > 0 ? round1((u.scoreSum / u.maxSum) * 100) : null;
        const byChasOut = {};
        for (const k of Object.keys(CHAS_LABEL)) {
          const stat = u.byChas?.[k] || { completedQuizzes: 0, scoreSum: 0, maxSum: 0 };
          byChasOut[k] = {
            completedQuizzes: stat.completedQuizzes,
            avgScorePct: stat.maxSum > 0 ? round1((stat.scoreSum / stat.maxSum) * 100) : null,
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

    const eligibleUsers = userIds.length;
    const participants = participantsSet.size;
    const participationRate = eligibleUsers > 0 ? round1((participants / eligibleUsers) * 100) : 0;

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
