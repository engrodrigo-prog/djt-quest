import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canCurate, canAccessStudio } from '../lib/rbac.js';
import { snapshotQuizVersion } from '../lib/quiz-versioning.js';
import { proofreadPtBrStrings } from '../lib/ai-proofread-ptbr.js';
const XP_BY_LEVEL = {
    // precisa respeitar o CHECK do banco (5,10,20,50)
    basico: 5,
    intermediario: 10,
    avancado: 20,
    especialista: 50,
};

const seededHash32 = (s) => {
    // FNV-1a 32-bit
    let h = 2166136261;
    const str = String(s || '');
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const mulberry32 = (seed) => {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
};

const seededShuffle = (arr, seedStr) => {
    const rng = mulberry32(seededHash32(seedStr));
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        const supabaseAdmin = createSupabaseAdminClient();
        const caller = await requireCallerUser(supabaseAdmin, req);
        const { challengeId, question_text, difficulty_level, options, skip_proofread, preserve_order, seed } = req.body || {};
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

        // Revisão ortográfica (best-effort) - preserva sentido.
        let revisedQuestionText = String(question_text || '');
        let revisedOptions = options;
        if (!skip_proofread) {
            try {
                const strings = [String(question_text || '')];
                for (const opt of options) {
                    strings.push(String(opt?.option_text || ''));
                    if (opt?.explanation)
                        strings.push(String(opt.explanation || ''));
                }
                const { output } = await proofreadPtBrStrings({ strings });
                let cursor = 0;
                revisedQuestionText = output[cursor++] ?? revisedQuestionText;
                revisedOptions = options.map((opt) => {
                    const option_text = output[cursor++] ?? String(opt?.option_text || '');
                    let explanation = opt?.explanation;
                    if (opt?.explanation) {
                        explanation = output[cursor++] ?? String(opt.explanation || '');
                    }
                    return { ...opt, option_text, explanation };
                });
            }
            catch {
                // ignore
            }
        }

        // Ordenação estável: coloca a pergunta no final do quiz
        let nextOrderIndex = 0;
        try {
            const { data: last } = await supabaseAdmin
                .from('quiz_questions')
                .select('order_index')
                .eq('challenge_id', challengeId)
                .order('order_index', { ascending: false })
                .limit(1);
            const max = Array.isArray(last) && last.length ? Number(last[0]?.order_index) : NaN;
            nextOrderIndex = (Number.isFinite(max) ? max : -1) + 1;
        }
        catch {
            nextOrderIndex = 0;
        }
        const { data: question, error: qErr } = await supabaseAdmin
            .from('quiz_questions')
            .insert({
                challenge_id: challengeId,
                question_text: revisedQuestionText,
                // OBS: precisa respeitar o CHECK do banco (basico/intermediario/avancado/especialista)
                difficulty_level: dl,
                xp_value: xp,
                order_index: nextOrderIndex,
                created_by: caller.id,
            })
            .select()
            .single();
        if (qErr)
            return res.status(400).json({ error: qErr.message });
        const toInsert = revisedOptions.map((opt) => ({
            question_id: question.id,
            option_text: String(opt?.option_text || '').trim(),
            is_correct: !!opt?.is_correct,
            explanation: (opt?.explanation && String(opt.explanation).trim()) || null,
        }));
        const shouldPreserve = Boolean(preserve_order);
        const seedStr = String(seed || '').trim();
        const shuffled = shouldPreserve
            ? toInsert
            : seedStr
                ? seededShuffle(toInsert, seedStr)
                : [...toInsert].sort(() => Math.random() - 0.5);
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
