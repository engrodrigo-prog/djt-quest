import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';
const XP_BY_LEVEL = {
    // precisa respeitar o CHECK do banco (5,10,20,50)
    basico: 5,
    intermediario: 10,
    avancado: 20,
    especialista: 50,
};
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        const supabaseAdmin = createSupabaseAdminClient();
        const caller = await requireCallerUser(supabaseAdmin, req);
        const { challengeId, question_text, difficulty_level, options } = req.body || {};
        if (!challengeId || !question_text || !difficulty_level || !Array.isArray(options)) {
            return res.status(400).json({ error: 'Campos obrigatórios: challengeId, question_text, difficulty_level, options[]' });
        }

        const { data: rolesRows } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', caller.id);
        const roleSet = rolesToSet(rolesRows);

        const { data: callerProfile } = await supabaseAdmin
            .from('profiles')
            .select('is_leader, studio_access')
            .eq('id', caller.id)
            .maybeSingle();
        if (!canAccessStudio({ roleSet, profile: callerProfile }))
            return res.status(403).json({ error: 'Forbidden' });
        const isCurator = canCurate({ roleSet, profile: callerProfile });

        const { data: quiz, error: quizErr } = await supabaseAdmin
            .from('challenges')
            .select('id, type, owner_id, created_by, quiz_workflow_status')
            .eq('id', challengeId)
            .maybeSingle();
        if (quizErr) return res.status(400).json({ error: quizErr.message });
        if (!quiz) return res.status(404).json({ error: 'Quiz não encontrado' });
        if (String(quiz.type || '') !== 'quiz') return res.status(400).json({ error: 'Desafio não é quiz' });

        const isOwner = String(quiz.owner_id || '') === caller.id || String(quiz.created_by || '') === caller.id;
        const workflow = String(quiz.quiz_workflow_status || 'PUBLISHED');

        if (workflow === 'DRAFT') {
            if (!isOwner && !isCurator) return res.status(403).json({ error: 'Sem permissão' });
        } else if (workflow === 'REJECTED') {
            // Owner can rework rejected quizzes, starting a new draft iteration
            if (!isOwner) return res.status(403).json({ error: 'Sem permissão' });
            try {
                await snapshotQuizVersion(supabaseAdmin, {
                    challengeId,
                    actorId: caller.id,
                    reason: 'edit:REJECTED',
                    auditAction: 'quiz.version.snapshot',
                });
            } catch {
                // best-effort
            }
            await supabaseAdmin
                .from('challenges')
                .update({ quiz_workflow_status: 'DRAFT', approved_at: null, approved_by: null })
                .eq('id', challengeId);
        } else {
            // After submission, only curator/admin can edit (and we snapshot for versioning)
            if (!isCurator) return res.status(403).json({ error: 'Sem permissão' });
            try {
                await snapshotQuizVersion(supabaseAdmin, {
                    challengeId,
                    actorId: caller.id,
                    reason: `add_question:${workflow}`,
                    auditAction: 'quiz.version.snapshot',
                });
            } catch {
                // best-effort
            }
        }

        const dl = String(difficulty_level);
        const xp = XP_BY_LEVEL[dl];
        if (!xp)
            return res.status(400).json({ error: 'difficulty_level inválido' });
        const { data: question, error: qErr } = await supabaseAdmin
            .from('quiz_questions')
            .insert({
                challenge_id: challengeId,
                question_text,
                // OBS: precisa respeitar o CHECK do banco (basico/intermediario/avancado/especialista)
                difficulty_level: dl,
                xp_value: xp,
                created_by: caller.id,
            })
            .select()
            .single();
        if (qErr)
            return res.status(400).json({ error: qErr.message });
        const toInsert = options.map((opt) => ({
            question_id: question.id,
            option_text: String(opt?.option_text || '').trim(),
            is_correct: !!opt?.is_correct,
            explanation: (opt?.explanation && String(opt.explanation).trim()) || null,
        }));
        // Embaralhar ordem das alternativas para evitar padrão fixo
        const shuffled = [...toInsert].sort(() => Math.random() - 0.5);
        const { error: oErr } = await supabaseAdmin.from('quiz_options').insert(shuffled);
        if (oErr)
            return res.status(400).json({ error: oErr.message });
        return res.status(200).json({ success: true, questionId: question.id });
    }
    catch (err) {
        return res.status(500).json({ error: err?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
