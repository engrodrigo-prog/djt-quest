import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const XP_BY_LEVEL = {
    basico: 10,
    intermediario: 20,
    avancado: 30,
    especialista: 50,
};
const LEVEL_MAP = {
    basico: 'basica',
    intermediario: 'intermediaria',
    avancado: 'avancada',
    especialista: 'especialista',
};
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return res.status(500).json({ error: 'Missing Supabase server configuration' });
        }
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
        if (!token)
            return res.status(401).json({ error: 'Unauthorized' });
        const { data: userResp, error: authErr } = await supabaseAdmin.auth.getUser(token);
        if (authErr || !userResp?.user)
            return res.status(401).json({ error: 'Unauthorized' });
        const userId = userResp.user.id;
        const { challengeId, question_text, difficulty_level, options } = req.body || {};
        if (!challengeId || !question_text || !difficulty_level || !Array.isArray(options)) {
            return res.status(400).json({ error: 'Campos obrigatórios: challengeId, question_text, difficulty_level, options[]' });
        }
        const dl = String(difficulty_level);
        const xp = XP_BY_LEVEL[dl];
        const dbLevel = LEVEL_MAP[dl];
        if (!xp || !dbLevel)
            return res.status(400).json({ error: 'difficulty_level inválido' });
        const { data: question, error: qErr } = await supabaseAdmin
            .from('quiz_questions')
            .insert({
            challenge_id: challengeId,
            question_text,
            difficulty_level: dbLevel,
            xp_value: xp,
            created_by: userId,
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
        const { error: oErr } = await supabaseAdmin.from('quiz_options').insert(toInsert);
        if (oErr)
            return res.status(400).json({ error: oErr.message });
        return res.status(200).json({ success: true, questionId: question.id });
    }
    catch (err) {
        return res.status(500).json({ error: err?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
