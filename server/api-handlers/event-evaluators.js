import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrlFromEnv } from '../lib/supabase-url.js';
import { DJT_QUEST_SUPABASE_HOST } from '../env-guard.js';

const SUPABASE_URL = getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true });
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = (process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY);
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'GET' && req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    if (!SUPABASE_URL || (!SERVICE_ROLE_KEY && !PUBLIC_KEY)) {
        return res.status(500).json({ error: 'Missing Supabase config' });
    }
    const eventId = (typeof req.query?.event_id === 'string' ? req.query.event_id : undefined) ||
        (req.body && typeof req.body.event_id === 'string' ? req.body.event_id : '');
    const eventIdClean = String(eventId || '').trim();
    if (!eventIdClean || !isUuid(eventIdClean)) {
        return res.status(400).json({ error: 'event_id inválido' });
    }
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token)
        return res.status(401).json({ error: 'Unauthorized' });
    const useServiceRole = Boolean(SERVICE_ROLE_KEY);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || PUBLIC_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    const authed = createClient(SUPABASE_URL, PUBLIC_KEY || SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: authHeader } },
    });
    let userId = null;
    try {
        if (useServiceRole) {
            const { data } = await admin.auth.getUser(token);
            userId = data?.user?.id || null;
        }
        else {
            const { data } = await authed.auth.getUser();
            userId = data?.user?.id || null;
        }
    }
    catch {
        userId = null;
    }
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { data: eventRow } = await admin
        .from('events')
        .select('id,user_id')
        .eq('id', eventIdClean)
        .maybeSingle();
    if (!eventRow?.id)
        return res.status(404).json({ error: 'Evento não encontrado' });
    let allowed = String(eventRow.user_id) === String(userId);
    if (!allowed) {
        try {
            if (useServiceRole) {
                const { data: staffFlag, error } = await admin.rpc('is_staff', { u: userId });
                if (!error && staffFlag)
                    allowed = true;
            }
        }
        catch { }
    }
    if (!allowed) {
        try {
            const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userId);
            allowed = (roles || []).some((r) => STAFF_ROLES.has(String(r?.role || '')));
        }
        catch {
            allowed = false;
        }
    }
    if (!allowed)
        return res.status(403).json({ error: 'Forbidden' });
    if (!useServiceRole) {
        return res.status(200).json({ event_id: eventIdClean, leaders: [], participants: [] });
    }
    const [{ data: assignments }, { data: participantsRows }] = await Promise.all([
        admin.from('evaluation_queue').select('assigned_to').eq('event_id', eventIdClean),
        admin.from('event_participants').select('user_id').eq('event_id', eventIdClean),
    ]);
    const leaderIds = Array.from(new Set((assignments || []).map((r) => String(r?.assigned_to || '')).filter(Boolean)));
    const participantIds = Array.from(new Set((participantsRows || []).map((r) => String(r?.user_id || '')).filter(Boolean))).filter((id) => id !== String(eventRow.user_id));
    const allIds = Array.from(new Set([...leaderIds, ...participantIds]));
    let profiles = [];
    try {
        const { data } = await admin
            .from('profiles')
            .select('id,name,mention_handle,email')
            .in('id', allIds.length ? allIds : ['00000000-0000-0000-0000-000000000000'])
            .limit(2000);
        profiles = Array.isArray(data) ? data : [];
    }
    catch {
        profiles = [];
    }
    const profileMap = new Map();
    profiles.forEach((p) => p?.id && profileMap.set(String(p.id), p));
    const leaders = leaderIds.map((id) => profileMap.get(String(id))).filter(Boolean);
    const participants = participantIds.map((id) => profileMap.get(String(id))).filter(Boolean);
    return res.status(200).json({ event_id: eventIdClean, leaders, participants });
}

export const config = { api: { bodyParser: true } };
