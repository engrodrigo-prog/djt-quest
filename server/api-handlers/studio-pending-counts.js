// @ts-nocheck
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrlFromEnv } from '../lib/supabase-url.js';
import { DJT_QUEST_SUPABASE_HOST } from '../env-guard.js';
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
const SUPABASE_URL = getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true });
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = (process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY);
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const LEADER_ROLES = new Set(['lider_equipe']);
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'GET')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
    const emptyPayload = {
        approvals: 0,
        passwordResets: 0,
        evaluations: 0,
        leadershipAssignments: 0,
        forumMentions: 0,
        registrations: 0,
        notifications: 0,
        campaigns: 0,
        quizzesPending: 0,
    };
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
        let isLeader = false;
        let leaderScope = { team_id: null, sigla_area: null, operational_base: null };
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
        try {
            const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userId);
            isLeader = (roles || []).some((r) => LEADER_ROLES.has(r.role));
        }
        catch { }
        let userProfile = null;
        try {
            const { data: p } = await admin
                .from('profiles')
                .select('team_id, sigla_area, operational_base, is_leader, coord_id, division_id')
                .eq('id', userId)
                .maybeSingle();
            userProfile = p || null;
            leaderScope = {
                team_id: p?.team_id || null,
                sigla_area: p?.sigla_area || null,
                operational_base: p?.operational_base || null,
            };
            if (p?.is_leader)
                isLeader = true;
        }
        catch { }
        const approvals = isStaff ? await safeCount(admin.from('profile_change_requests').eq('status', 'pending')) : 0;
        // Password resets: staff vê tudo; líder vê do próprio time (se houver team_id)
        let passwordResets = 0;
        if (isStaff) {
            passwordResets = await safeCount(admin.from('password_reset_requests').eq('status', 'pending'));
        }
        else if (isLeader && leaderScope.team_id) {
            try {
                const { data: rows, error } = await admin
                    .from('password_reset_requests')
                    .select('id, user:profiles!password_reset_requests_user_id_fkey(team_id)')
                    .eq('status', 'pending')
                    .limit(500);
                if (!error) {
                    passwordResets = (rows || []).filter((r) => String(r?.user?.team_id || '') === String(leaderScope.team_id)).length;
                }
            }
            catch { }
        }
        const evaluations = await safeCount(admin.from('evaluation_queue').eq('assigned_to', userId).is('completed_at', null));
        const leadershipAssignments = await safeCount(admin.from('leadership_challenge_assignments').eq('user_id', userId).eq('status', 'assigned'));
        const forumMentions = await safeCount(admin.from('forum_mentions').eq('mentioned_user_id', userId).eq('is_read', false));
        // Registrations: staff vê tudo; líder vê pendências compatíveis com sua sigla/base
        let pendingRegistrations = 0;
        if (isStaff) {
            pendingRegistrations = await safeCount(admin.from('pending_registrations').eq('status', 'pending'));
        }
        else if (isLeader) {
            const candidates = [leaderScope.sigla_area, leaderScope.operational_base, 'CONVIDADOS', 'EXTERNO']
                .map((s) => String(s || '').trim().toUpperCase())
                .filter(Boolean);
            const uniq = Array.from(new Set(candidates));
            if (uniq.length) {
                try {
                    const { count, error } = await admin
                        .from('pending_registrations')
                        .select('id', { count: 'exact', head: true })
                        .eq('status', 'pending')
                        .in('sigla_area', uniq);
                    if (!error)
                        pendingRegistrations = count || 0;
                }
                catch { }
            }
        }

        // Notificações gerais (mentions, avaliações, etc.) via tabela notifications
        const notifications = await safeCount(
            admin.from('notifications').eq('user_id', userId).eq('read', false)
        );

        // Campanhas ativas (vigentes por data) — filtradas por alvo de time/coord/div se houver
        let campaigns = 0;
        try {
            const now = new Date().toISOString();
            const { data: campaignRows } = await admin
                .from('campaigns')
                .select('id, is_active, start_date, end_date, target_team_ids, target_coord_ids, target_div_ids');

            const teamId = userProfile?.team_id ? String(userProfile.team_id) : null;
            const coordId = userProfile?.coord_id ? String(userProfile.coord_id) : null;
            const divId = userProfile?.division_id ? String(userProfile.division_id) : null;

            campaigns = (campaignRows || []).filter((c) => {
                if (!c?.is_active) return false;
                const startOk = !c.start_date || c.start_date <= now;
                const endOk = !c.end_date || c.end_date >= now;
                if (!startOk || !endOk) return false;
                const targetsTeam = Array.isArray(c.target_team_ids) && c.target_team_ids.length;
                const targetsCoord = Array.isArray(c.target_coord_ids) && c.target_coord_ids.length;
                const targetsDiv = Array.isArray(c.target_div_ids) && c.target_div_ids.length;
                const matchTeam = !targetsTeam || (teamId && c.target_team_ids.map(String).includes(teamId));
                const matchCoord = !targetsCoord || (coordId && c.target_coord_ids.map(String).includes(coordId));
                const matchDiv = !targetsDiv || (divId && c.target_div_ids.map(String).includes(divId));
                return matchTeam && matchCoord && matchDiv;
            }).length;
        }
        catch { campaigns = 0; }

        // Quizzes pendentes: desafios do tipo quiz, ativos, sem tentativa submetida
        let quizzesPending = 0;
        try {
            const now = new Date().toISOString();
            const { data: quizChallenges } = await admin
                .from('challenges')
                .select('id, type, status, start_date, end_date, target_team_ids, target_coord_ids, target_div_ids');

            const { data: attempts } = await admin
                .from('quiz_attempts')
                .select('challenge_id, submitted_at')
                .eq('user_id', userId);
            const completed = new Set(
                (attempts || [])
                    .filter((a) => a.submitted_at)
                    .map((a) => String(a.challenge_id))
            );

            const teamId = userProfile?.team_id ? String(userProfile.team_id) : null;
            const coordId = userProfile?.coord_id ? String(userProfile.coord_id) : null;
            const divId = userProfile?.division_id ? String(userProfile.division_id) : null;

            quizzesPending = (quizChallenges || []).filter((c) => {
                const type = String(c?.type || '').toLowerCase();
                if (!type.includes('quiz')) return false;
                const status = String(c?.status || 'active').toLowerCase();
                if (status === 'closed' || status === 'canceled' || status === 'cancelled') return false;
                const startOk = !c.start_date || c.start_date <= now;
                const endOk = !c.end_date || c.end_date >= now;
                if (!startOk || !endOk) return false;
                const targetsTeam = Array.isArray(c.target_team_ids) && c.target_team_ids.length;
                const targetsCoord = Array.isArray(c.target_coord_ids) && c.target_coord_ids.length;
                const targetsDiv = Array.isArray(c.target_div_ids) && c.target_div_ids.length;
                const matchTeam = !targetsTeam || (teamId && c.target_team_ids.map(String).includes(teamId));
                const matchCoord = !targetsCoord || (coordId && c.target_coord_ids.map(String).includes(coordId));
                const matchDiv = !targetsDiv || (divId && c.target_div_ids.map(String).includes(divId));
                if (!matchTeam || !matchCoord || !matchDiv) return false;
                return !completed.has(String(c.id || ''));
            }).length;
        }
        catch { quizzesPending = 0; }

        return res.status(200).json({
            approvals,
            passwordResets,
            evaluations,
            leadershipAssignments,
            forumMentions,
            registrations: pendingRegistrations,
            notifications,
            campaigns,
            quizzesPending,
        });
    }
    catch (err) {
        return res.status(200).json({
            approvals: 0,
            passwordResets: 0,
            evaluations: 0,
            leadershipAssignments: 0,
            forumMentions: 0,
            registrations: 0,
            notifications: 0,
            campaigns: 0,
            quizzesPending: 0,
        });
    }
}
export const config = { api: { bodyParser: false } };
