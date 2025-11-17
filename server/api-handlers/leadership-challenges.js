import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALLOWED_CREATORS = new Set([
    'cveiga@cpfl.com.br',
    'rodrigonasc@cpfl.com.br',
]);
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    try {
        if (!SUPABASE_URL || !SERVICE_ROLE)
            return res.status(500).json({ error: 'Missing Supabase server config' });
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
        const authHeader = req.headers['authorization'];
        if (!authHeader?.startsWith('Bearer '))
            return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.slice(7);
        const { data: userData, error: userErr } = await admin.auth.getUser(token);
        if (userErr || !userData?.user)
            return res.status(401).json({ error: 'Unauthorized' });
        const email = (userData.user.email || '').toLowerCase();
        if (req.method === 'POST') {
            if (!ALLOWED_CREATORS.has(email))
                return res.status(403).json({ error: 'Somente planejamento/gerência podem criar' });
            const body = req.body || {};
            const { title, description = null, theme = null, okr_key = null, project_code = null, start_date = null, due_date = null, allow_early = true, allow_late = false, target_roles = ['coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt'], } = body;
            if (!title || !due_date)
                return res.status(400).json({ error: 'title e due_date são obrigatórios' });
            const creatorId = userData.user.id;
            // 1) create challenge
            const { data: challenge, error: chErr } = await admin
                .from('challenges')
                .insert([{
                    title,
                    description,
                    theme,
                    audience: 'leaders',
                    created_by: creatorId,
                    start_date,
                    due_date,
                    allow_early,
                    allow_late,
                    status: start_date ? 'scheduled' : 'active',
                    okr_key,
                    project_code,
                    type: 'atitude',
                    xp_reward: 20,
                }])
                .select()
                .single();
            if (chErr || !challenge)
                return res.status(400).json({ error: chErr?.message || 'Falha ao criar desafio' });
            // 2) assign to leaders by roles
            const { data: leaders, error: lErr } = await admin
                .from('user_roles')
                .select('user_id, role')
                .in('role', target_roles);
            if (lErr)
                return res.status(400).json({ error: lErr.message });
            const uniqueUsers = Array.from(new Set((leaders || []).map((r) => r.user_id)));
            const payload = uniqueUsers.map((uid) => ({ challenge_id: challenge.id, user_id: uid, due_date }));
            if (payload.length) {
                const { error: aErr } = await admin.from('leadership_challenge_assignments').insert(payload);
                if (aErr)
                    return res.status(400).json({ error: aErr.message });
            }
            return res.status(200).json({ id: challenge.id, assigned: payload.length });
        }
        if (req.method === 'PATCH') {
            if (!ALLOWED_CREATORS.has(email))
                return res.status(403).json({ error: 'Somente planejamento/gerência' });
            const id = req.query?.id || req.body?.id;
            const action = req.query?.action || req.body?.action;
            if (!id || !action)
                return res.status(400).json({ error: 'id e action obrigatórios' });
            if (action === 'cancel') {
                const { error: upErr } = await admin.from('challenges').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', id);
                if (upErr)
                    return res.status(400).json({ error: upErr.message });
                const { error: lErr } = await admin.from('leadership_challenge_assignments').update({ status: 'canceled' }).eq('challenge_id', id);
                if (lErr)
                    return res.status(400).json({ error: lErr.message });
                return res.status(200).json({ ok: true });
            }
            return res.status(400).json({ error: 'ação não suportada' });
        }
        return res.status(405).json({ error: 'Method not allowed' });
    }
    catch (err) {
        return res.status(500).json({ error: err?.message || 'unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
