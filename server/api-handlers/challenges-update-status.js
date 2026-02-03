import { createClient } from '@supabase/supabase-js';
import { DJT_QUEST_SUPABASE_HOST } from '../env-guard.js';
import { getSupabaseUrlFromEnv } from '../lib/supabase-url.js';
import { isAllowlistedAdmin } from '../lib/admin-allowlist.js';
const SUPABASE_URL = getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true });
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        if (!SUPABASE_URL || !SERVICE_KEY)
            return res.status(500).json({ error: 'Missing Supabase config' });
        const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const authHeader = req.headers['authorization'];
        if (!authHeader?.startsWith('Bearer '))
            return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.slice(7);
        const { data: userData } = await admin.auth.getUser(token);
        const uid = userData?.user?.id;
        const email = String(userData?.user?.email || '').toLowerCase();
        if (!uid)
            return res.status(401).json({ error: 'Unauthorized' });
        const { id, status } = req.body || {};
        if (!id || !status)
            return res.status(400).json({ error: 'id and status required' });
        const nextStatus = String(status || '').trim().toLowerCase();
        const allowedStatuses = new Set(['active', 'closed', 'canceled', 'cancelled']);
        if (!allowedStatuses.has(nextStatus))
            return res.status(400).json({ error: 'Invalid status' });
        // Determine if target is a quiz (quizzes have stricter permissions)
        const { data: chall, error: chErr } = await admin
            .from('challenges')
            .select('id,type')
            .eq('id', id)
            .maybeSingle();
        if (chErr)
            return res.status(400).json({ error: chErr.message });
        if (!chall?.id)
            return res.status(404).json({ error: 'Challenge not found' });
        const isQuiz = String(chall.type || '').toLowerCase().includes('quiz');
        if (isQuiz) {
            const { data: prof } = await admin.from('profiles').select('matricula,email').eq('id', uid).maybeSingle();
            const matricula = String(prof?.matricula || '').trim();
            const profileEmail = String(prof?.email || '').trim().toLowerCase();
            if (!isAllowlistedAdmin({ email: email || profileEmail, matricula }))
                return res.status(403).json({ error: 'Insufficient permissions' });
        }
        else {
            // Non-quiz: allow coordinators/managers/admins (legacy behavior)
            const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid);
            const allowed = new Set(['coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt', 'admin']);
            if (!roles?.some((r) => allowed.has(r.role)))
                return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const { error } = await admin.from('challenges').update({ status: nextStatus }).eq('id', id);
        if (error)
            return res.status(400).json({ error: error.message });
        return res.status(200).json({ success: true });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
