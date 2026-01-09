import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, hasRole, ROLE } from '../lib/rbac.js';

const STAFF_ROLES = new Set([ROLE.ADMIN, ROLE.MANAGER, ROLE.DIV_MANAGER, ROLE.COORD]);

const getStrParam = (req, key) => {
  const v = req?.query?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s != null ? String(s).trim() : '';
};

const normalizeKey = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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
    if (!isStaff) return res.status(403).json({ error: 'Forbidden' });

    const q = getStrParam(req, 'q');
    const leaderId = getStrParam(req, 'leaderId');
    const normalizedQ = normalizeKey(q);
    const leaderFilter = leaderId && leaderId !== 'all';
    const pendingStatuses = new Set([
      'submitted',
      'awaiting_evaluation',
      'awaiting_second_evaluation',
      'retry_pending',
      'retry_in_progress',
    ]);

    // 1) Pending assignments (queue)
    const { data: queueRows, error: queueErr } = await admin
      .from('evaluation_queue')
      .select('id,event_id,assigned_to,assigned_at,completed_at,is_cross_evaluation,created_at')
      .is('completed_at', null)
      .order('assigned_at', { ascending: false })
      .limit(500);
    if (queueErr) return res.status(400).json({ error: queueErr.message });

    const pendingAssignments = Array.isArray(queueRows) ? queueRows : [];
    const eventIds = Array.from(new Set(pendingAssignments.map((r) => r.event_id).filter(Boolean)));

    // 2) Events (submissions) + challenge/user
    const eventsById = new Map();
    const challengeIds = new Set();
    const userIds = new Set();
    const evaluatorIds = new Set();

    const registerEvent = (e) => {
      if (!e?.id) return;
      if (eventsById.has(e.id)) return;
      eventsById.set(e.id, e);
      if (e.challenge_id) challengeIds.add(e.challenge_id);
      if (e.user_id) userIds.add(e.user_id);
      if (e.first_evaluator_id) evaluatorIds.add(e.first_evaluator_id);
      if (e.second_evaluator_id) evaluatorIds.add(e.second_evaluator_id);
    };

    for (const ids of chunk(eventIds, 200)) {
      const { data: events, error: evErr } = await admin
        .from('events')
        .select(
          'id,created_at,status,awaiting_second_evaluation,first_evaluation_rating,second_evaluation_rating,first_evaluator_id,second_evaluator_id,retry_count,evidence_urls,payload,challenge_id,user_id',
        )
        .in('id', ids);
      if (evErr) return res.status(400).json({ error: evErr.message });
      for (const e of events || []) registerEvent(e);
    }

    const { data: statusEvents, error: statusErr } = await admin
      .from('events')
      .select(
        'id,created_at,status,awaiting_second_evaluation,first_evaluation_rating,second_evaluation_rating,first_evaluator_id,second_evaluator_id,retry_count,evidence_urls,payload,challenge_id,user_id',
      )
      .in('status', Array.from(pendingStatuses))
      .order('created_at', { ascending: false })
      .limit(500);
    if (statusErr) return res.status(400).json({ error: statusErr.message });
    for (const e of statusEvents || []) registerEvent(e);

    // 3) Challenges
    const challengesById = new Map();
    for (const ids of chunk(Array.from(challengeIds), 200)) {
      const { data: rows, error } = await admin.from('challenges').select('id,title,require_two_leader_eval').in('id', ids);
      if (error) return res.status(400).json({ error: error.message });
      for (const row of rows || []) challengesById.set(row.id, row);
    }

    // 4) Evaluations for pending events
    const evalsByEvent = new Map(); // event_id -> eval[]
    const reviewerIds = new Set();
    const allEventIds = Array.from(eventsById.keys());
    for (const ids of chunk(allEventIds, 200)) {
      const { data: evals, error } = await admin
        .from('action_evaluations')
        .select('id,event_id,reviewer_id,evaluation_number,rating,final_rating,created_at,feedback_positivo,feedback_construtivo')
        .in('event_id', ids)
        .order('created_at', { ascending: true });
      if (error) return res.status(400).json({ error: error.message });
      for (const ev of evals || []) {
        reviewerIds.add(ev.reviewer_id);
        const list = evalsByEvent.get(ev.event_id) || [];
        list.push(ev);
        evalsByEvent.set(ev.event_id, list);
      }
    }

    // 5) Profiles (submitter, assigned, reviewers, evaluators)
    const allProfileIds = new Set([
      ...Array.from(userIds),
      ...pendingAssignments.map((r) => r.assigned_to).filter(Boolean),
      ...Array.from(reviewerIds),
      ...Array.from(evaluatorIds),
    ]);
    const profilesById = new Map();
    for (const ids of chunk(Array.from(allProfileIds), 200)) {
      const { data: rows, error } = await admin.from('profiles').select('id,name,email,matricula,is_leader,team_id,coord_id,division_id').in('id', ids);
      if (error) return res.status(400).json({ error: error.message });
      for (const p of rows || []) profilesById.set(p.id, p);
    }

    // 6) Group pending events
    const grouped = new Map(); // event_id -> { event, challenge, submitter, assignments, evaluations }
    const assignmentsByEvent = new Map();
    for (const row of pendingAssignments) {
      const event = eventsById.get(row.event_id);
      if (!event) continue;
      const assigned = row.assigned_to ? profilesById.get(row.assigned_to) || null : null;
      const list = assignmentsByEvent.get(row.event_id) || [];
      list.push({
        id: row.id,
        assigned_to: row.assigned_to,
        assigned_name: assigned?.name || null,
        assigned_at: row.assigned_at,
        is_cross_evaluation: Boolean(row.is_cross_evaluation),
        created_at: row.created_at,
      });
      assignmentsByEvent.set(row.event_id, list);
    }

    let pending = Array.from(eventsById.entries()).map(([event_id, ev]) => {
      const challenge = challengesById.get(ev.challenge_id) || null;
      const submitter = profilesById.get(ev.user_id) || null;
      const evidenceUrls = Array.isArray(ev?.evidence_urls) ? ev.evidence_urls : [];
      const payloadEvidence = Array.isArray(ev?.payload?.evidence_urls) ? ev.payload.evidence_urls : [];
      const mergedEvidence = Array.from(new Set([...evidenceUrls, ...payloadEvidence])).filter(Boolean).slice(0, 12);

      const evaluations = (evalsByEvent.get(event_id) || []).map((evItem) => ({
        id: evItem.id,
        reviewer_id: evItem.reviewer_id,
        reviewer_name: profilesById.get(evItem.reviewer_id)?.name || null,
        evaluation_number: evItem.evaluation_number,
        rating: evItem.rating,
        final_rating: evItem.final_rating,
        created_at: evItem.created_at,
        feedback_positivo: evItem.feedback_positivo,
        feedback_construtivo: evItem.feedback_construtivo,
      }));
      const evalCount = evaluations.length;
      const stage = challenge?.require_two_leader_eval ? (evalCount === 0 ? 'pending_first' : 'pending_second') : 'pending';
      return {
        event_id,
        created_at: ev.created_at,
        status: ev.status,
        awaiting_second_evaluation: Boolean(ev.awaiting_second_evaluation),
        retry_count: Number(ev.retry_count || 0),
        challenge: challenge ? { id: challenge.id, title: challenge.title, require_two_leader_eval: Boolean(challenge.require_two_leader_eval) } : null,
        submitter: submitter ? { id: submitter.id, name: submitter.name, matricula: submitter.matricula || null } : null,
        evidence_urls: mergedEvidence,
        first_evaluation_rating: ev.first_evaluation_rating ?? null,
        second_evaluation_rating: ev.second_evaluation_rating ?? null,
        first_evaluator: ev.first_evaluator_id ? { id: ev.first_evaluator_id, name: profilesById.get(ev.first_evaluator_id)?.name || null } : null,
        second_evaluator: ev.second_evaluator_id ? { id: ev.second_evaluator_id, name: profilesById.get(ev.second_evaluator_id)?.name || null } : null,
        assignments: assignmentsByEvent.get(event_id) || [],
        evaluations,
        stage,
      };
    });

    // Optional filters
    if (leaderFilter) {
      pending = pending.filter((p) => (p.assignments || []).some((a) => String(a.assigned_to || '') === String(leaderId)));
    }
    if (normalizedQ) {
      pending = pending.filter((p) => {
        const hay = normalizeKey(
          [
            p?.challenge?.title,
            p?.submitter?.name,
            p?.submitter?.matricula,
            ...(p?.assignments || []).map((a) => a.assigned_name),
          ]
            .filter(Boolean)
            .join(' '),
        );
        return hay.includes(normalizedQ) || String(p.event_id || '').includes(q);
      });
    }

    pending = pending.filter((p) => pendingStatuses.has(String(p.status || '').toLowerCase()));

    // Leader workload
    const pendingByLeader = new Map(); // leader_id -> count
    for (const r of pendingAssignments) {
      if (!r.assigned_to) continue;
      pendingByLeader.set(r.assigned_to, (pendingByLeader.get(r.assigned_to) || 0) + 1);
    }
    const leader_stats = Array.from(pendingByLeader.entries())
      .map(([id, count]) => ({
        leader_id: id,
        leader_name: profilesById.get(id)?.name || null,
        pending: count,
      }))
      .sort((a, b) => (b.pending || 0) - (a.pending || 0))
      .slice(0, 200);

    // History (recent evaluations)
    let historyQuery = admin
      .from('action_evaluations')
      .select('id,event_id,reviewer_id,evaluation_number,rating,final_rating,created_at')
      .order('created_at', { ascending: false })
      .limit(250);
    if (leaderFilter) historyQuery = historyQuery.eq('reviewer_id', leaderId);
    const { data: histRows, error: histErr } = await historyQuery;
    if (histErr) return res.status(400).json({ error: histErr.message });

    const hist = Array.isArray(histRows) ? histRows : [];
    const histEventIds = Array.from(new Set(hist.map((h) => h.event_id).filter(Boolean))).slice(0, 500);
    const histEventsById = new Map();
    const histChallengeIds = new Set();
    const histUserIds = new Set();
    for (const ids of chunk(histEventIds, 200)) {
      const { data: rows, error } = await admin
        .from('events')
        .select('id,created_at,status,challenge_id,user_id')
        .in('id', ids);
      if (error) return res.status(400).json({ error: error.message });
      for (const e of rows || []) {
        histEventsById.set(e.id, e);
        if (e.challenge_id) histChallengeIds.add(e.challenge_id);
        if (e.user_id) histUserIds.add(e.user_id);
      }
    }
    const histChallengesById = new Map();
    for (const ids of chunk(Array.from(histChallengeIds), 200)) {
      const { data: rows, error } = await admin.from('challenges').select('id,title').in('id', ids);
      if (error) return res.status(400).json({ error: error.message });
      for (const c of rows || []) histChallengesById.set(c.id, c);
    }
    const histProfilesById = new Map(profilesById);
    for (const ids of chunk(Array.from(histUserIds), 200)) {
      const missing = ids.filter((id) => !histProfilesById.has(id));
      if (!missing.length) continue;
      const { data: rows, error } = await admin.from('profiles').select('id,name,matricula').in('id', missing);
      if (error) return res.status(400).json({ error: error.message });
      for (const p of rows || []) histProfilesById.set(p.id, p);
    }

    let history = hist.map((h) => {
      const ev = histEventsById.get(h.event_id) || null;
      const challenge = ev?.challenge_id ? histChallengesById.get(ev.challenge_id) || null : null;
      const submitter = ev?.user_id ? histProfilesById.get(ev.user_id) || null : null;
      const reviewer = h.reviewer_id ? histProfilesById.get(h.reviewer_id) || null : null;
      return {
        id: h.id,
        event_id: h.event_id,
        created_at: h.created_at,
        evaluation_number: h.evaluation_number,
        rating: h.rating,
        final_rating: h.final_rating,
        reviewer: reviewer ? { id: reviewer.id, name: reviewer.name } : { id: h.reviewer_id, name: null },
        submitter: submitter ? { id: submitter.id, name: submitter.name, matricula: submitter.matricula || null } : null,
        challenge: challenge ? { id: challenge.id, title: challenge.title } : null,
        event_status: ev?.status || null,
      };
    });

    if (normalizedQ) {
      history = history.filter((h) => {
        const hay = normalizeKey([h?.reviewer?.name, h?.submitter?.name, h?.submitter?.matricula, h?.challenge?.title].filter(Boolean).join(' '));
        return hay.includes(normalizedQ) || String(h.event_id || '').includes(q);
      });
    }

    return res.status(200).json({
      success: true,
      pending,
      leader_stats,
      history,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
