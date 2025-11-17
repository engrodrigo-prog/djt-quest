import { createClient } from '@supabase/supabase-js';
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
        const authHeader = req.headers['authorization'] || '';
        if (!authHeader)
            return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.replace('Bearer ', '');
        const { data: userData } = await admin.auth.getUser(token);
        const requesterId = userData.user?.id;
        if (!requesterId)
            return res.status(401).json({ error: 'Unauthorized' });
        // Only staff can run this
        const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', requesterId);
        const allowed = (roles || []).some(r => ['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx'].includes(r.role));
        if (!allowed)
            return res.status(403).json({ error: 'Insufficient permissions' });
        const { challengeId, title, setActive } = req.body || {};
        if (!challengeId && !title)
            return res.status(400).json({ error: 'Provide challengeId or title' });
        const sel = challengeId ? { id: challengeId } : { title };
        const { data: ch, error: chErr } = await admin.from('challenges').select('id,title,status').match(sel).maybeSingle();
        if (chErr || !ch)
            return res.status(404).json({ error: 'Challenge not found' });
        const updates = { target_team_ids: null, target_coord_ids: null, target_div_ids: null };
        if (setActive)
            updates.status = 'active';
        const { error: upErr } = await admin.from('challenges').update(updates).eq('id', ch.id);
        if (upErr)
            return res.status(400).json({ error: upErr.message });
        return res.status(200).json({ success: true, id: ch.id });
    }
    catch (err) {
        return res.status(400).json({ error: err?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
