import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate } from '../lib/rbac.js';
import { structureQuestionsWithAi } from '../lib/ai-curation-provider.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    if (!canCurate(roleSet)) return res.status(403).json({ error: 'Forbidden' });

    const { importId } = req.body || {};
    const id = String(importId || '').trim();
    if (!id) return res.status(400).json({ error: 'importId required' });

    const { data: imp, error: impErr } = await admin.from('content_imports').select('*').eq('id', id).maybeSingle();
    if (impErr) return res.status(400).json({ error: impErr.message });
    if (!imp) return res.status(404).json({ error: 'Import not found' });

    const raw = imp.raw_extract;
    const kind = String(raw?.kind || '').trim();
    if (!kind) return res.status(400).json({ error: 'Import not extracted yet' });

    // If already structured (csv/xlsx/json), we can promote extracted questions to ai_suggested without calling AI.
    if ((kind === 'csv' || kind === 'xlsx' || kind === 'json') && Array.isArray(raw?.questions)) {
      const ai_suggested = { model: 'passthrough', questions: raw.questions };
      const { data: updated, error } = await admin
        .from('content_imports')
        .update({ status: 'AI_SUGGESTED', ai_suggested })
        .eq('id', id)
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true, import: updated, usedModel: 'passthrough' });
    }

    const textishKinds = new Set(['pdf', 'docx', 'txt', 'image', 'json']);
    const text = textishKinds.has(kind) ? String(raw?.text || '') : JSON.stringify(raw);
    const ai = await structureQuestionsWithAi({ input: text });
    if (!ai.ok) return res.status(400).json({ error: ai.error });

    const ai_suggested = { model: ai.model, questions: ai.questions };
    const { data: updated, error } = await admin
      .from('content_imports')
      .update({ status: 'AI_SUGGESTED', ai_suggested })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'import.ai_suggest',
      entity_type: 'content_import',
      entity_id: id,
      before_json: { status: imp.status },
      after_json: { status: updated.status, model: ai.model, count: ai.questions.length },
    });

    return res.status(200).json({ success: true, import: updated, usedModel: ai.model });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
