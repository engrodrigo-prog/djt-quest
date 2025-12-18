import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

const letterToKey = (letter) => {
  const L = String(letter || '').trim().toUpperCase();
  if (!L) return null;
  if (['A', 'B', 'C', 'D', 'E'].includes(L)) return L;
  return null;
};

const toOptionTuples = (q) => {
  const alts = [
    ['A', q.alt_a],
    ['B', q.alt_b],
    ['C', q.alt_c],
    ['D', q.alt_d],
    ['E', q.alt_e],
  ];
  return alts
    .map(([k, v]) => [k, String(v || '').trim()])
    .filter(([, v]) => v.length > 0);
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canCurate({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const { importId, challengeId, source } = req.body || {};
    const iid = String(importId || '').trim();
    const cid = String(challengeId || '').trim();
    const pick = String(source || 'final').trim().toLowerCase();
    if (!iid) return res.status(400).json({ error: 'importId required' });
    if (!cid) return res.status(400).json({ error: 'challengeId required' });

    const { data: imp, error: impErr } = await admin.from('content_imports').select('*').eq('id', iid).maybeSingle();
    if (impErr) return res.status(400).json({ error: impErr.message });
    if (!imp) return res.status(404).json({ error: 'Import not found' });

    const payload = pick === 'ai' ? imp.ai_suggested : imp.final_approved;
    const questions = Array.isArray(payload?.questions) ? payload.questions : Array.isArray(payload) ? payload : null;
    if (!questions || questions.length === 0) return res.status(400).json({ error: 'No questions to apply' });

    const { data: quiz, error: quizErr } = await admin
      .from('challenges')
      .select('id, type, quiz_workflow_status')
      .eq('id', cid)
      .maybeSingle();
    if (quizErr) return res.status(400).json({ error: quizErr.message });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (String(quiz.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });
    const workflow = String(quiz.quiz_workflow_status || 'PUBLISHED');
    if (workflow !== 'DRAFT') return res.status(400).json({ error: 'Quiz must be in DRAFT to apply imports' });

    const { data: maxRow } = await admin
      .from('quiz_questions')
      .select('order_index')
      .eq('challenge_id', cid)
      .order('order_index', { ascending: false })
      .limit(1);
    const maxOrder = Number(maxRow?.[0]?.order_index);
    const baseOrder = Number.isFinite(maxOrder) ? maxOrder : -1;

    let created = 0;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i] || {};
      const pergunta = String(q.pergunta || '').trim();
      if (!pergunta) continue;
      const correctLetter = letterToKey(q.correta);
      const optionTuples = toOptionTuples(q);
      if (optionTuples.length < 4) continue;
      if (!correctLetter) continue;
      if (!optionTuples.some(([L]) => L === correctLetter)) continue;

      const { data: insertedQ, error: insQErr } = await admin
        .from('quiz_questions')
        .insert({
          challenge_id: cid,
          question_text: pergunta,
          difficulty_level: 'basico',
          xp_value: 5,
          order_index: baseOrder + 1 + created,
          created_by: caller.id,
        })
        .select('id')
        .single();
      if (insQErr) return res.status(400).json({ error: insQErr.message });

      const optionsToInsert = optionTuples.map(([L, text]) => ({
        question_id: insertedQ.id,
        option_text: text,
        is_correct: L === correctLetter,
        explanation: q.explicacao ? String(q.explicacao).trim() : null,
      }));

      const { error: insOErr } = await admin.from('quiz_options').insert(optionsToInsert);
      if (insOErr) return res.status(400).json({ error: insOErr.message });

      created++;
    }

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'import.apply_to_quiz',
      entity_type: 'quiz',
      entity_id: cid,
      before_json: { import_id: iid, source: pick },
      after_json: { created_questions: created },
    });

    return res.status(200).json({ success: true, created_questions: created });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
