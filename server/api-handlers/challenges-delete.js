import { createClient } from '@supabase/supabase-js';
import { isAllowlistedAdmin } from '../lib/admin-allowlist.js';
const SUPABASE_URL = process.env.SUPABASE_URL;
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
        const { id } = req.body || {};
        if (!id)
            return res.status(400).json({ error: 'id required' });
        // Only allowlisted admins (for now) can delete quizzes
        const { data: prof } = await admin.from('profiles').select('matricula,email').eq('id', uid).maybeSingle();
        const matricula = String(prof?.matricula || '').trim();
        const profileEmail = String(prof?.email || '').trim().toLowerCase();
        if (!isAllowlistedAdmin({ email: email || profileEmail, matricula }))
            return res.status(403).json({ error: 'Insufficient permissions' });
        // Ensure it's a quiz
        const { data: chall, error: chErr } = await admin.from('challenges').select('type').eq('id', id).maybeSingle();
        if (chErr)
            return res.status(400).json({ error: chErr.message });
        if (!chall)
            return res.status(404).json({ error: 'Challenge not found' });
        if (!String(chall.type || '').toLowerCase().includes('quiz'))
            return res.status(400).json({ error: 'Only quiz challenges can be deleted here' });
        // Delete: FKs on quiz_questions -> options cascade; events may exist (historical) so block if any answers exist
        const { count: answersCnt } = await admin.from('user_quiz_answers').select('id', { count: 'exact', head: true }).eq('challenge_id', id);
        if ((answersCnt || 0) > 0) {
            return res.status(400).json({ error: 'Quiz has responses. Archive or close instead of deleting.' });
        }
        const { error: delErr } = await admin.from('challenges').delete().eq('id', id);
        if (delErr)
            return res.status(400).json({ error: delErr.message });
        return res.status(200).json({ success: true });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
