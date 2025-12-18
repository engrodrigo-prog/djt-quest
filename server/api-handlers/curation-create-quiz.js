import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const description = body.description != null ? String(body.description) : null;
    const xpRewardRaw = body.xp_reward;
    const xp_reward = Number.isFinite(Number(xpRewardRaw)) ? Number(xpRewardRaw) : 0;
    const quiz_specialties = Array.isArray(body.quiz_specialties) ? body.quiz_specialties : body.quiz_specialties || null;
    const chasRaw = body.chas_dimension != null ? String(body.chas_dimension).trim().toUpperCase() : null;
    const chas_dimension = chasRaw && ['C', 'H', 'A', 'S'].includes(chasRaw) ? chasRaw : null;

    if (title.length < 3) return res.status(400).json({ error: 'Título inválido' });

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);

    const { data: callerProfile } = await admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle();
    if (!canAccessStudio({ roleSet, profile: callerProfile })) return res.status(403).json({ error: 'Forbidden' });

    // Leaders already have insert policy; content_curator (or invited curator) can create quizzes as well.
    const isCurator = canCurate({ roleSet, profile: callerProfile });
    const ownerId = caller.id;

    const insertFull = {
      title,
      description,
      type: 'quiz',
      owner_id: ownerId,
      created_by: caller.id,
      quiz_workflow_status: 'DRAFT',
      require_two_leader_eval: false,
      evidence_required: false,
      xp_reward,
      ...(quiz_specialties !== undefined ? { quiz_specialties } : {}),
      ...(chas_dimension ? { chas_dimension } : {}),
    };

    let created = null;
    const { data: created1, error: err1 } = await admin
      .from('challenges')
      .insert(insertFull)
      .select('id, title, description, quiz_workflow_status, owner_id, created_by, created_at')
      .single();
    if (!err1) {
      created = created1;
    } else {
      // Compat: environments without new columns
      const minimal = {
        title,
        description,
        type: 'quiz',
        created_by: caller.id,
        require_two_leader_eval: false,
        evidence_required: false,
        xp_reward,
      };
      const { data: created2, error: err2 } = await admin
        .from('challenges')
        .insert(minimal)
        .select('id, title, description, created_by, created_at')
        .single();
      if (err2) return res.status(400).json({ error: err2.message });
      created = created2;
    }

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.create',
      entity_type: 'quiz',
      entity_id: created.id,
      before_json: null,
      after_json: { ...created, created_as_curator: isCurator },
    });

    return res.status(200).json({ success: true, quiz: created });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
