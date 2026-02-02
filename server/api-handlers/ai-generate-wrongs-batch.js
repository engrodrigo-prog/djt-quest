import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canAccessStudio } from '../lib/rbac.js';
import { generateWrongOptions } from './ai-generate-wrongs.js';

const clampItems = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(Math.floor(n), 30));
};

const mapWithConcurrency = async (items, limit, fn) => {
  const out = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { error: e?.message || String(e) };
      }
    }
  });
  await Promise.all(workers);
  return out;
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const language = String(body.language || 'pt-BR').trim() || 'pt-BR';
    const difficulty = String(body.difficulty || '').trim();
    const count = body.count ?? 3;
    const context = body.context ?? null;
    const maxItems = clampItems(body.maxItems ?? itemsRaw.length);
    const items = itemsRaw.slice(0, maxItems);

    if (!items.length) return res.status(400).json({ error: 'items[] required' });

    // Authz: only Studio-access users (same as parse-quiz-text).
    const supabaseAdmin = createSupabaseAdminClient();
    const caller = await requireCallerUser(supabaseAdmin, req);
    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      supabaseAdmin.from('user_roles').select('role').eq('user_id', caller.id),
      supabaseAdmin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    const globalContext = context ?? items.map((it) => ({
      question: String(it?.question || it?.question_text || '').trim(),
      correct: String(it?.correct || it?.correct_text || '').trim(),
    }));

    const results = await mapWithConcurrency(items, 4, async (it) => {
      const question = String(it?.question || it?.question_text || '').trim();
      const correct = String(it?.correct || it?.correct_text || '').trim();
      if (!question || !correct) return { wrong: [], meta: { usedAi: false }, error: 'question/correct required' };
      const out = await generateWrongOptions({
        question,
        correct,
        difficulty: String(it?.difficulty || difficulty || 'intermediario').trim() || 'intermediario',
        language,
        count,
        context: globalContext,
      });
      return { wrong: out.wrong, meta: { usedAi: out.usedAi } };
    });

    const usedAi = results.some((r) => Boolean(r?.meta?.usedAi));
    return res.status(200).json({ items: results, meta: { usedAi } });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

