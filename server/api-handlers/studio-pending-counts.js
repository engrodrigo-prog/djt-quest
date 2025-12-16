// @ts-nocheck
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
// Lightweight .env loader for local dev (avoids dependency on dotenv)
try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const text = fs.readFileSync(envPath, 'utf8');
        for (const line of text.split(/\r?\n/)) {
            const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
            if (match && !process.env[match[1]]) {
                process.env[match[1]] = match[2];
            }
        }
    }
}
catch { }
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = (process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY);
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'GET')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        const emptyPayload = { approvals: 0, passwordResets: 0, evaluations: 0, leadershipAssignments: 0, forumMentions: 0, registrations: 0 };
        if (!SUPABASE_URL || (!SERVICE_ROLE_KEY && !PUBLIC_KEY)) {
            return res.status(200).json(emptyPayload);
        }
        const authHeader = req.headers['authorization'] || '';
        const useServiceRole = Boolean(SERVICE_ROLE_KEY);
        const admin = useServiceRole
            ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
                auth: { autoRefreshToken: false, persistSession: false },
            })
            : createClient(SUPABASE_URL, PUBLIC_KEY, {
                auth: { autoRefreshToken: false, persistSession: false },
                global: authHeader ? { headers: { Authorization: authHeader } } : {},
            });
    let userId = null;
    try {
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) {
            return res.status(200).json(emptyPayload);
        }
        const { data: userData } = await admin.auth.getUser(token);
        userId = userData?.user?.id || null;
    }
        catch { }
        const safeCount = async (query) => {
            try {
                const { count, error } = await query.select('id', { count: 'exact', head: true });
                if (error)
                    return 0;
                return count || 0;
            }
            catch {
                return 0;
            }
        };
        if (!userId) {
            return res.status(200).json(emptyPayload);
        }
        // Check roles to know if user is staff (leaders / managers / admin)
        let isStaff = false;
        try {
            const { data: staffFlag, error: staffErr } = await admin.rpc('is_staff', { u: userId });
            if (!staffErr) {
                isStaff = Boolean(staffFlag);
            }
            else {
                const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userId);
                isStaff = (roles || []).some((r) => STAFF_ROLES.has(r.role));
            }
        }
        catch { }
        const approvals = isStaff ? await safeCount(admin.from('profile_change_requests').eq('status', 'pending')) : 0;
        const passwordResets = isStaff ? await safeCount(admin.from('password_reset_requests').eq('status', 'pending')) : 0;
        const evaluations = await safeCount(admin.from('evaluation_queue').eq('assigned_to', userId).is('completed_at', null));
        const leadershipAssignments = await safeCount(admin.from('leadership_challenge_assignments').eq('user_id', userId).eq('status', 'assigned'));
        const forumMentions = await safeCount(admin.from('forum_mentions').eq('mentioned_user_id', userId).eq('is_read', false));
        const pendingRegistrations = isStaff ? await safeCount(admin.from('pending_registrations').eq('status', 'pending')) : 0;
        return res.status(200).json({ approvals, passwordResets, evaluations, leadershipAssignments, forumMentions, registrations: pendingRegistrations });
    }
    catch (err) {
        return res.status(200).json({ approvals: 0, passwordResets: 0, evaluations: 0, leadershipAssignments: 0, forumMentions: 0, registrations: 0 });
    }
}
export const config = { api: { bodyParser: false } };
