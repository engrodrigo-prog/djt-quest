import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GUEST_TEAM_ID = 'CONVIDADOS';
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const normTeamCode = (raw) => String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
const computeScope = async (admin, userId) => {
    const [{ data: rolesData }, { data: profile }] = await Promise.all([
        admin.from('user_roles').select('role').eq('user_id', userId),
        admin.from('profiles').select('team_id, coord_id, division_id, is_leader, studio_access, sigla_area, operational_base').eq('id', userId).maybeSingle(),
    ]);
    const roles = (rolesData || []).map((r) => String(r.role || ''));
    const roleSet = new Set(roles);
    const isLeader = Boolean(profile?.is_leader);
    let effectiveRole = null;
    if (roleSet.has('admin'))
        effectiveRole = 'admin';
    else if (roleSet.has('gerente_djt'))
        effectiveRole = 'gerente_djt';
    else if (roleSet.has('gerente_divisao_djtx'))
        effectiveRole = 'gerente_divisao_djtx';
    else if (roleSet.has('coordenador_djtx'))
        effectiveRole = 'coordenador_djtx';
    else if (roleSet.has('lider_equipe') || isLeader)
        effectiveRole = 'lider_equipe';
    const studioAccess = Boolean(profile?.studio_access) || roles.some((r) => STAFF_ROLES.has(r)) || roleSet.has('lider_equipe') || isLeader;
    let teamId = profile?.team_id || null;
    if (!teamId) {
        const fallback = normTeamCode(profile?.sigla_area || profile?.operational_base);
        teamId = fallback || null;
    }
    let coordId = profile?.coord_id || null;
    let divisionId = profile?.division_id || null;
    if (teamId && !coordId) {
        try {
            const { data } = await admin.from('teams').select('coord_id').eq('id', teamId).maybeSingle();
            coordId = data?.coord_id || null;
        }
        catch { }
    }
    if (coordId && !divisionId) {
        try {
            const { data } = await admin.from('coordinations').select('division_id').eq('id', coordId).maybeSingle();
            divisionId = data?.division_id || null;
        }
        catch { }
    }
    return { roles, roleSet, studioAccess, effectiveRole, teamId, coordId, divisionId };
};
const inScope = (regSiglaRaw, scope) => {
    const sigla = String(regSiglaRaw || '').trim().toUpperCase();
    if (!sigla)
        return false;
    if (sigla === 'EXTERNO' || sigla === GUEST_TEAM_ID)
        return true;
    const div = String(scope.divisionId || '').toUpperCase();
    const coord = String(scope.coordId || '').toUpperCase();
    const team = String(scope.teamId || '').toUpperCase();
    if (scope.effectiveRole === 'admin' || scope.effectiveRole === 'gerente_djt')
        return true;
    if (scope.effectiveRole === 'gerente_divisao_djtx')
        return !!div && sigla.startsWith(div);
    if (scope.effectiveRole === 'coordenador_djtx')
        return (!!div && sigla.startsWith(div)) || (!!coord && sigla.startsWith(coord)) || (!!team && sigla === team);
    if (scope.effectiveRole === 'lider_equipe')
        return !!team && sigla === team;
    return false;
};
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        if (!SUPABASE_URL)
            return res.status(500).json({ error: 'Missing SUPABASE_URL' });
        if (!SERVICE_ROLE_KEY)
            return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' });
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const authHeader = req.headers['authorization'] || '';
        let requesterId = null;
        if (authHeader) {
            try {
                const { data } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
                requesterId = data.user?.id || null;
            }
            catch { }
        }
        // Verify permissions
        if (!requesterId)
            return res.status(401).json({ error: 'Unauthorized' });
        const scope = await computeScope(admin, requesterId);
        if (!scope.studioAccess || !scope.effectiveRole)
            return res.status(403).json({ error: 'Insufficient permissions' });
        const body = req.body;
        if (!body?.registrationId)
            return res.status(400).json({ error: 'registrationId required' });
        const { data: reg, error: regErr } = await admin
            .from('pending_registrations')
            .select('*')
            .eq('id', body.registrationId)
            .eq('status', 'pending')
            .single();
        if (regErr || !reg)
            return res.status(404).json({ error: 'Registration not found or processed' });
        if (!reg.date_of_birth) {
            return res.status(400).json({ error: 'Data de nascimento ausente na solicitação. Peça ao usuário para reenviar o cadastro.' });
        }
        const overrideSiglaRaw = typeof body?.override_sigla_area === 'string' ? body.override_sigla_area : null;
        const overrideBaseRaw = typeof body?.override_operational_base === 'string' ? body.override_operational_base : null;
        const forceGuest = Boolean(body?.force_guest) ||
            String(overrideSiglaRaw || '').trim().toUpperCase() === GUEST_TEAM_ID ||
            String(overrideBaseRaw || '').trim().toUpperCase() === GUEST_TEAM_ID;
        const desiredSigla = forceGuest ? GUEST_TEAM_ID : normTeamCode(overrideSiglaRaw || reg.sigla_area) || normTeamCode(reg.sigla_area);
        const desiredBase = forceGuest ? GUEST_TEAM_ID : String(overrideBaseRaw || reg.operational_base || '').trim().slice(0, 80);
        if (!desiredSigla)
            return res.status(400).json({ error: 'Sigla/base inválida. Ajuste antes de aprovar.' });
        if (!inScope(desiredSigla, scope))
            return res.status(403).json({ error: 'Fora do escopo' });
        // Prevent duplicate approvals
        const { data: existingProfile } = await admin
            .from('profiles')
            .select('id')
            .eq('email', reg.email)
            .maybeSingle();
        if (existingProfile?.id) {
            return res.status(400).json({ error: 'Já existe um perfil ativo com este e-mail. Rejeite ou edite o usuário existente.' });
        }
        // Create auth user
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email: reg.email,
            password: '123456',
            email_confirm: true,
            user_metadata: { name: reg.name },
        });
        if (createErr)
            return res.status(400).json({ error: createErr.message });
        const newUserId = created.user.id;
        // Create or update profile to avoid duplicate key on retries
        const { error: profErr } = await admin.from('profiles').upsert({
            id: newUserId,
            name: reg.name,
            email: reg.email,
            matricula: reg.matricula,
            phone: reg.telefone || null,
            operational_base: desiredBase || reg.operational_base,
            sigla_area: desiredSigla,
            date_of_birth: reg.date_of_birth,
            must_change_password: true,
            needs_profile_completion: true,
        }, { onConflict: 'id' });
        if (profErr) {
            await admin.auth.admin.deleteUser(newUserId);
            return res.status(400).json({ error: profErr.message });
        }
        const regSigla = String(desiredSigla || '').trim().toUpperCase();
        const isGuest = regSigla === 'EXTERNO' || regSigla === GUEST_TEAM_ID;
        if (isGuest) {
            try {
                await admin.from('teams').upsert({ id: GUEST_TEAM_ID, name: 'Convidados (externo)' }, { onConflict: 'id' });
            }
            catch { }
            await admin
                .from('profiles')
                .update({
                sigla_area: GUEST_TEAM_ID,
                operational_base: GUEST_TEAM_ID,
                team_id: GUEST_TEAM_ID,
                coord_id: null,
                division_id: null,
            })
                .eq('id', newUserId);
        }
        else {
            const desiredTeamId = normTeamCode(desiredSigla);
            if (desiredTeamId) {
                try {
                    const { data: existing } = await admin.from('teams').select('id').eq('id', desiredTeamId).maybeSingle();
                    if (!existing?.id) {
                        await admin.from('teams').insert({ id: desiredTeamId, name: desiredTeamId });
                    }
                }
                catch { }
            }
            const deriveOrg = async (raw) => {
                const s = String(raw || '')
                    .toUpperCase()
                    .replace(/[^A-Z0-9-]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
                if (!s)
                    return null;
                let teamId = null;
                let coordId = null;
                let divisionId = null;
                const { data: team } = await admin.from('teams').select('id, coord_id').eq('id', s).maybeSingle();
                if (team?.id) {
                    teamId = team.id;
                    coordId = team.coord_id;
                    if (coordId) {
                        const { data: coord } = await admin.from('coordinations').select('division_id').eq('id', coordId).maybeSingle();
                        divisionId = coord?.division_id || null;
                    }
                }
                else if (s.includes('-')) {
                    const [div, tag] = s.split('-', 2);
                    divisionId = div || null;
                    coordId = div && tag ? `${div}-${tag}` : null;
                    if (tag) {
                        const { data: t2 } = await admin.from('teams').select('id').eq('id', tag).maybeSingle();
                        if (t2?.id)
                            teamId = t2.id;
                    }
                }
                if (!divisionId && coordId) {
                    const { data: coord } = await admin.from('coordinations').select('division_id').eq('id', coordId).maybeSingle();
                    divisionId = coord?.division_id || null;
                }
                if (!divisionId && !coordId && !teamId)
                    return null;
                return { divisionId, coordId, teamId };
            };
            const org = await deriveOrg(desiredSigla || desiredBase || reg.sigla_area || reg.operational_base);
            if (org) {
                await admin.from('profiles').update({ division_id: org.divisionId, coord_id: org.coordId, team_id: org.teamId }).eq('id', newUserId);
            }
            else if (desiredTeamId) {
                await admin.from('profiles').update({ team_id: desiredTeamId }).eq('id', newUserId);
            }
        }
        // Assign roles (base role depends on invited/guest flag)
        const requestedRolesRaw = Array.isArray(body?.roles) ? body.roles : [];
        const requestedRoles = requestedRolesRaw.map((r) => String(r || '').trim()).filter(Boolean);
        const assignCurator = Boolean(body?.assign_content_curator) || requestedRoles.includes('content_curator');
        const baseRole = isGuest ? 'invited' : 'colaborador';
        const rolesToAssign = [baseRole, ...(assignCurator ? ['content_curator'] : [])];

        const { error: roleErr } = await admin
            .from('user_roles')
            .insert(rolesToAssign.map((role) => ({ user_id: newUserId, role })));
        if (roleErr && !String(roleErr.message || '').toLowerCase().includes('duplicate')) {
            await admin.auth.admin.deleteUser(newUserId);
            return res.status(400).json({ error: roleErr.message });
        }
        // Update registration
        await admin
            .from('pending_registrations')
            .update({
            status: 'approved',
            reviewed_by: requesterId,
            reviewed_at: new Date().toISOString(),
            review_notes: body.notes || null,
            sigla_area: desiredSigla,
            operational_base: desiredBase || reg.operational_base,
        })
            .eq('id', body.registrationId);

        // Audit (best-effort)
        try {
            await admin.from('audit_log').insert({
                actor_id: requesterId,
                action: 'registration.approve',
                entity_type: 'pending_registration',
                entity_id: String(body.registrationId),
                before_json: reg,
                after_json: { user_id: newUserId, roles: rolesToAssign, sigla_area: desiredSigla, operational_base: desiredBase || reg.operational_base },
            });
        }
        catch { }
        return res.status(200).json({ success: true, userId: newUserId });
    }
    catch (err) {
        return res.status(400).json({ error: err?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
