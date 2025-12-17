import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const challengeId = String(req.query?.id || '').trim();
    if (!challengeId) return res.status(400).json({ error: 'id required' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const isCurator = canCurate(roleSet);
    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const { data: ch, error: chErr } = await admin.from('challenges').select('*').eq('id', challengeId).maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!ch) return res.status(404).json({ error: 'Quiz not found' });
    if (String(ch.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const isOwner = String(ch.owner_id || '') === caller.id || String(ch.created_by || '') === caller.id;
    if (!isOwner && !isCurator) return res.status(403).json({ error: 'Forbidden' });

    const { data: questions, error: qErr } = await admin
      .from('quiz_questions')
      .select('*')
      .eq('challenge_id', challengeId)
      .order('order_index', { ascending: true });
    if (qErr) return res.status(400).json({ error: qErr.message });

    const qIds = (questions || []).map((q) => q.id);
    let options = [];
    if (qIds.length) {
      const { data: opts, error: oErr } = await admin.from('quiz_options').select('*').in('question_id', qIds);
      if (oErr) return res.status(400).json({ error: oErr.message });
      options = opts || [];
    }

    const optionsByQ = new Map();
    for (const opt of options) {
      const k = String(opt.question_id || '');
      if (!optionsByQ.has(k)) optionsByQ.set(k, []);
      optionsByQ.get(k).push(opt);
    }

    const assembled = (questions || []).map((q) => ({ ...q, options: optionsByQ.get(String(q.id)) || [] }));

    return res.status(200).json({ success: true, quiz: ch, questions: assembled, canCurate: isCurator, isOwner });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };
