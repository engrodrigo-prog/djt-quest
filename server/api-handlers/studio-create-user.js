import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const GUEST_TEAM_ID = 'CONVIDADOS';
const normTeamCode = (raw) => String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
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
        const { data: requester, error: reqAuthErr } = await admin.auth.getUser(token);
        const requesterId = requester?.user?.id || null;
        if (reqAuthErr || !requesterId)
            return res.status(401).json({ error: 'Unauthorized' });
        const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', requesterId);
        const allowed = new Set(['admin', 'coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt']);
        let hasPermission = (roles || []).some((r) => allowed.has(r.role));
        if (!hasPermission) {
            const { data: callerProfile } = await admin
                .from('profiles')
                .select('is_leader, studio_access')
                .eq('id', requesterId)
                .maybeSingle();
            hasPermission = Boolean(callerProfile?.is_leader) || Boolean(callerProfile?.studio_access);
        }
        if (!hasPermission)
            return res.status(403).json({ error: 'Insufficient permissions' });
        const body = req.body || {};
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const name = String(body.name || '').trim();
        const role = String(body.role || '').trim();
        const requestedTeam = typeof body.team_id === 'string' ? body.team_id : body.team_id ?? null;
        const teamId = requestedTeam ? normTeamCode(requestedTeam) : null;
        if (!email || !email.includes('@'))
            return res.status(400).json({ error: 'email inválido' });
        if (!password || password.length < 6)
            return res.status(400).json({ error: 'password deve ter no mínimo 6 caracteres' });
        if (!name)
            return res.status(400).json({ error: 'name é obrigatório' });
        if (!role)
            return res.status(400).json({ error: 'role é obrigatório' });
        const isGuest = String(teamId || '').toUpperCase() === GUEST_TEAM_ID || String(body.is_guest || '').toLowerCase() === 'true';
        if (isGuest) {
            try {
                await admin.from('teams').upsert({ id: GUEST_TEAM_ID, name: 'Convidados (externo)' }, { onConflict: 'id' });
            }
            catch { }
        }
        else if (teamId) {
            try {
                const { data: existing } = await admin.from('teams').select('id').eq('id', teamId).maybeSingle();
                if (!existing?.id) {
                    await admin.from('teams').insert({ id: teamId, name: teamId });
                }
            }
            catch { }
        }
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { name },
        });
        if (createErr)
            return res.status(400).json({ error: createErr.message });
        const newUserId = created.user?.id;
        if (!newUserId)
            return res.status(400).json({ error: 'Falha ao criar usuário' });
        let divisionId = null;
        let coordId = null;
        let finalTeamId = null;
        if (isGuest) {
            finalTeamId = GUEST_TEAM_ID;
        }
        else if (teamId) {
            finalTeamId = teamId;
            try {
                const { data: t } = await admin.from('teams').select('coord_id').eq('id', teamId).maybeSingle();
                coordId = t?.coord_id || null;
                if (coordId) {
                    const { data: c } = await admin.from('coordinations').select('division_id').eq('id', coordId).maybeSingle();
                    divisionId = c?.division_id || null;
                }
            }
            catch { }
        }
        const profilePayload = {
            id: newUserId,
            email,
            name,
            xp: 0,
            tier: 'EX-1',
            must_change_password: true,
            needs_profile_completion: false,
            team_id: finalTeamId,
            division_id: divisionId,
            coord_id: coordId,
            sigla_area: isGuest ? GUEST_TEAM_ID : finalTeamId,
            operational_base: isGuest ? GUEST_TEAM_ID : finalTeamId,
        };
        const { error: profErr } = await admin.from('profiles').upsert(profilePayload, { onConflict: 'id' });
        if (profErr) {
            await admin.auth.admin.deleteUser(newUserId);
            return res.status(400).json({ error: profErr.message });
        }
        const { error: roleErr } = await admin.from('user_roles').insert({ user_id: newUserId, role });
        if (roleErr && !String(roleErr.message || '').toLowerCase().includes('duplicate')) {
            await admin.auth.admin.deleteUser(newUserId);
            return res.status(400).json({ error: roleErr.message });
        }
        return res.status(200).json({
            success: true,
            user: { id: newUserId, email, name, role, team_id: finalTeamId },
        });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };

