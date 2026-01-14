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
    // Observação: usamos o score/max_score do quiz_attempts (muito mais leve que varrer user_quiz_answers).
    const byQuiz = new Map(); // challenge_id -> { attempts, scoreSum, maxSum }
    const attemptStats = new Map(); // `${user_id}:${challenge_id}` -> { score, max }
    const participantsSet = new Set();
    const challengeSet = new Set();

    const userIdChunks = chunk(userIds, 400);
    const concurrency = 3;
    for (let i = 0; i < userIdChunks.length; i += concurrency) {
      const slice = userIdChunks.slice(i, i + concurrency);
      const results = await Promise.all(
        slice.map((ids) =>
          admin
            .from('quiz_attempts')
            .select('user_id, challenge_id, submitted_at, score, max_score')
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
          const pct = toPct(row?.score, row?.max_score);
          const max = Number(row?.max_score) || 0;
          const score = Number(row?.score) || 0;
          if (pct == null || max <= 0) continue;

          participantsSet.add(uid);
          challengeSet.add(cid);
          attemptStats.set(`${uid}:${cid}`, { score, max });

          const q = byQuiz.get(cid) || { attempts: 0, scoreSum: 0, maxSum: 0 };
          q.attempts += 1;
          q.scoreSum += score;
          q.maxSum += max;
          byQuiz.set(cid, q);
        }
      }
    }

    const challengeIds = Array.from(challengeSet);
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
          byChas: { C: { completedQuizzes: 0, avgScorePct: null }, H: { completedQuizzes: 0, avgScorePct: null }, A: { completedQuizzes: 0, avgScorePct: null }, S: { completedQuizzes: 0, avgScorePct: null } },
        })),
      });
    }

    // 3) Agregar por tema (CHAS) e por usuário com base no score/max_score.
    const byChas = new Map(); // chas -> { quizzes:Set, participants:Set, scoreSum, maxSum }
    const byUser = new Map(); // user_id -> { completedQuizzes, scoreSum, maxSum, byChas: {chas:{completedQuizzes,scoreSum,maxSum}} }
    for (const [k, stat] of attemptStats.entries()) {
      const [uid, cid] = String(k).split(':');
      const meta = quizzesMeta.get(String(cid));
      if (!meta) continue;
      const chas = normalizeChas(meta.chas_dimension);

      const t = byChas.get(chas) || { chas, label: CHAS_LABEL[chas] || chas, quizzes: new Set(), participants: new Set(), scoreSum: 0, maxSum: 0 };
      t.quizzes.add(String(cid));
      t.participants.add(String(uid));
      t.scoreSum += Number(stat.score) || 0;
      t.maxSum += Number(stat.max) || 0;
      byChas.set(chas, t);

      const u = byUser.get(String(uid)) || { user_id: String(uid), completedQuizzes: 0, scoreSum: 0, maxSum: 0, byChas: {} };
      u.completedQuizzes += 1;
      u.scoreSum += Number(stat.score) || 0;
      u.maxSum += Number(stat.max) || 0;
      u.byChas[chas] = u.byChas[chas] || { completedQuizzes: 0, scoreSum: 0, maxSum: 0 };
      u.byChas[chas].completedQuizzes += 1;
      u.byChas[chas].scoreSum += Number(stat.score) || 0;
      u.byChas[chas].maxSum += Number(stat.max) || 0;
      byUser.set(String(uid), u);
    }

    const quizzes = quizIds
      .map((cid) => {
        const meta = quizzesMeta.get(cid);
        const agg = byQuiz.get(cid) || { attempts: 0, scoreSum: 0, maxSum: 0 };
        const avgScorePct = agg.maxSum > 0 ? Math.round(((agg.scoreSum / agg.maxSum) * 100) * 10) / 10 : null;
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
        const avgScorePct = t.maxSum > 0 ? Math.round(((t.scoreSum / t.maxSum) * 100) * 10) / 10 : null;
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
        const avgScorePct = u.maxSum > 0 ? Math.round(((u.scoreSum / u.maxSum) * 100) * 10) / 10 : null;
        const byChasOut = {};
        for (const k of Object.keys(CHAS_LABEL)) {
          const stat = u.byChas?.[k] || { completedQuizzes: 0, scoreSum: 0, maxSum: 0 };
          byChasOut[k] = {
            completedQuizzes: stat.completedQuizzes,
            avgScorePct: stat.maxSum > 0 ? Math.round(((stat.scoreSum / stat.maxSum) * 100) * 10) / 10 : null,
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
