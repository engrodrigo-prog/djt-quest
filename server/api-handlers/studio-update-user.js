import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canManageUsers, sanitizeRoleList, normalizeRole, ROLE } from '../lib/rbac.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';
const normalizeSigla = (value) => {
    if (typeof value !== 'string')
        return null;
    const cleaned = value.trim().toUpperCase();
    return cleaned || null;
};
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
        const supabaseAdmin = createSupabaseAdminClient();
        const caller = await requireCallerUser(supabaseAdmin, req);
        const callerId = caller.id;
        const isEnumValueMissingError = (msg, value) => {
            const m = String(msg || '').toLowerCase();
            return m.includes('invalid input value for enum') && m.includes('app_role') && m.includes(String(value || '').toLowerCase());
        };
        let warning = null;

        const [{ data: callerRolesRows }, { data: callerProfile }] = await Promise.all([
            supabaseAdmin.from('user_roles').select('role').eq('user_id', callerId),
            supabaseAdmin.from('profiles').select('is_leader, studio_access').eq('id', callerId).maybeSingle(),
        ]);
        const callerRoleSet = rolesToSet(callerRolesRows);

        // Permission check: user management remains restricted (leaders/managers/admin)
        // - Admin/gerentes/coordenadores always allowed
        // - Leaders (profile flag) allowed for limited role assignment only
        const isManagement = canManageUsers({ roleSet: callerRoleSet, profile: callerProfile });
        const isLeaderFlag = Boolean(callerProfile?.is_leader) || callerRoleSet.has(ROLE.TEAM_LEADER);
        const hasPermission = isManagement || isLeaderFlag;
        if (!hasPermission) return res.status(403).json({ error: 'Sem permissão' });

        const body = req.body || {};
        const { userId } = body;
        if (!userId)
            return res.status(400).json({ error: 'userId é obrigatório' });

        // Proibir auto-atribuição de role pelo próprio usuário
        const isSelf = String(userId) === String(callerId);

        // Load before state for audit
        const [{ data: beforeProfile }, { data: beforeRolesRows }] = await Promise.all([
            supabaseAdmin.from('profiles').select('*').eq('id', userId).maybeSingle(),
            supabaseAdmin.from('user_roles').select('role').eq('user_id', userId),
        ]);

        const updates = {};
        if (typeof body.name === 'string')
            updates.name = body.name;
        if (typeof body.email === 'string')
            updates.email = body.email.toLowerCase();
        if (typeof body.matricula !== 'undefined')
            updates.matricula = body.matricula ?? null;
        if (typeof body.team_id !== 'undefined')
            updates.team_id = body.team_id ?? null;
        if (typeof body.phone === 'string' || body.phone === null) {
            const raw = typeof body.phone === 'string' ? body.phone : '';
            const cleaned = raw.trim().replace(/[^0-9+()\s-]/g, '');
            updates.phone = cleaned || null;
            // Admin/leader edit counts as confirmation
            updates.phone_confirmed_at = cleaned ? new Date().toISOString() : null;
        }
        const hasSigla = Object.prototype.hasOwnProperty.call(body, 'sigla_area');
        const hasBase = Object.prototype.hasOwnProperty.call(body, 'operational_base');
        if (hasSigla) {
            const sigla = normalizeSigla(body.sigla_area);
            updates.sigla_area = sigla;
            updates.operational_base = sigla;
        }
        else if (hasBase) {
            const sigla = normalizeSigla(body.operational_base);
            updates.sigla_area = sigla;
            updates.operational_base = sigla;
        }
        if (typeof body.is_leader !== 'undefined')
            updates.is_leader = !!body.is_leader;
        if (typeof body.studio_access !== 'undefined')
            updates.studio_access = !!body.studio_access;
        if (typeof body.date_of_birth !== 'undefined')
            updates.date_of_birth = body.date_of_birth ?? null;
        // Update Auth if needed
        if (body.email || body.name) {
            const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
                email: body.email,
                user_metadata: body.name ? { name: body.name } : undefined,
            });
            if (updErr)
                return res.status(400).json({ error: `Auth update failed: ${updErr.message}` });
        }
        if (Object.keys(updates).length > 0) {
            const { error: profErr } = await supabaseAdmin.from('profiles').update(updates).eq('id', userId);
            if (profErr)
                return res.status(400).json({ error: `Profile update failed: ${profErr.message}` });
        }

        // Role changes (optional)
        const legacyRole = body.role ? normalizeRole(body.role) : '';
        const addRoles = sanitizeRoleList(body.add_roles);
        const removeRoles = sanitizeRoleList(body.remove_roles);
        const replaceRoles = sanitizeRoleList(body.replace_roles);

        const wantsRoleChange = Boolean(legacyRole || addRoles.length || removeRoles.length || replaceRoles.length);
        if (wantsRoleChange) {
            if (isSelf) return res.status(403).json({ error: 'Não é permitido alterar o próprio papel' });

            // Leaders can only assign invited/content_curator/lider_equipe/colaborador.
            // Admin (or management) can assign higher roles, but only Admin can grant admin.
            const allowedForLeader = new Set([ROLE.COLLAB, ROLE.INVITED, ROLE.TEAM_LEADER, ROLE.CONTENT_CURATOR]);
            const requested = new Set(
                [
                    legacyRole,
                    ...addRoles,
                    ...removeRoles,
                    ...replaceRoles,
                ].filter(Boolean),
            );

            const isAdmin = callerRoleSet.has(ROLE.ADMIN);

            if (!isManagement) {
                // leader flag only
                for (const r of requested) {
                    if (!allowedForLeader.has(r)) {
                        return res.status(403).json({ error: `Sem permissão para atribuir role: ${r}` });
                    }
                }
            } else {
                // management can manage most roles, but admin role is restricted to ADMIN only
                if (!isAdmin && requested.has(ROLE.ADMIN)) {
                    return res.status(403).json({ error: 'Apenas ADMIN pode atribuir role admin' });
                }
                // content_curator role is allowed for management and leaders; ok.
                // No special-casing for others here.
            }

            const existingSet = rolesToSet(beforeRolesRows);
            let desiredSet = new Set(Array.from(existingSet));

            const applyReplace = replaceRoles.length > 0;
            if (applyReplace) {
                desiredSet = new Set(replaceRoles);
            }

            if (legacyRole) {
                // Legacy "single role" semantics: replace only within the known base/staff set.
                const replaceable = new Set([
                    ROLE.COLLAB,
                    ROLE.INVITED,
                    ROLE.TEAM_LEADER,
                    ROLE.CONTENT_CURATOR,
                    ROLE.COORD,
                    ROLE.DIV_MANAGER,
                    ROLE.MANAGER,
                    ROLE.ADMIN,
                    // compat
                    'gerente',
                    'lider_divisao',
                    'coordenador',
                ].map(normalizeRole));
                for (const r of Array.from(desiredSet)) {
                    if (replaceable.has(normalizeRole(r))) desiredSet.delete(r);
                }
                desiredSet.add(legacyRole);
            }

            for (const r of addRoles) desiredSet.add(r);
            for (const r of removeRoles) desiredSet.delete(r);

            // Ensure mutual exclusivity: invited vs colaborador (keep explicit selection)
            if (desiredSet.has(ROLE.INVITED)) desiredSet.delete(ROLE.COLLAB);
            if (desiredSet.has(ROLE.COLLAB)) desiredSet.delete(ROLE.INVITED);

            // Apply diff
            const toAdd = Array.from(desiredSet).filter((r) => !existingSet.has(r));
            const toRemove = Array.from(existingSet).filter((r) => !desiredSet.has(r));

            if (toRemove.length) {
                const { error: delErr } = await supabaseAdmin.from('user_roles').delete().eq('user_id', userId).in('role', toRemove);
                if (delErr)
                    return res.status(400).json({ error: `Role update failed: ${delErr.message}` });
            }
            if (toAdd.length) {
                const { error: insErr } = await supabaseAdmin.from('user_roles').insert(toAdd.map((r) => ({ user_id: userId, role: r })));
                if (insErr) {
                    // Back-compat: some DBs still have app_role enum without newer values.
                    // If the goal is to grant "curation-only" access for invited users, we can
                    // fall back to profiles.studio_access without failing the entire save.
                    const requestedCurator = toAdd.includes(ROLE.CONTENT_CURATOR) || requested.has(ROLE.CONTENT_CURATOR);
                    const studioAccessOnProfile = Boolean(updates?.studio_access) || Boolean(beforeProfile?.studio_access);
                    if (requestedCurator && studioAccessOnProfile && isEnumValueMissingError(insErr.message, 'content_curator')) {
                        // Proceed with warning: user will still be treated as curator via auth-me fallback.
                        warning =
                            'Banco com enum app_role desatualizado: não foi possível gravar role content_curator. Usando fallback via profiles.studio_access (curadoria-only).';
                    }
                    else {
                        return res.status(400).json({ error: `Role update failed: ${insErr.message}` });
                    }
                }
            }
        }
        const { data: updated } = await supabaseAdmin
            .from('profiles')
            .select('id, email, name, matricula, team_id, operational_base, sigla_area, is_leader, studio_access, phone, phone_confirmed_at')
            .eq('id', userId)
            .maybeSingle();

        // Audit (best-effort)
        const { data: afterRolesRows } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', userId);
        await tryInsertAuditLog(supabaseAdmin, {
            actor_id: callerId,
            action: 'user.update',
            entity_type: 'profile',
            entity_id: String(userId),
            before_json: { profile: beforeProfile, roles: (beforeRolesRows || []).map((r) => r.role) },
            after_json: { profile: updated, roles: (afterRolesRows || []).map((r) => r.role) },
        });

        return res.status(200).json({ success: true, profile: updated, ...(warning ? { warning } : {}) });
    }
    catch (err) {
        return res.status(500).json({ error: err?.message || 'Unknown error' });
    }
}
export const config = {
    api: {
        bodyParser: true,
    },
};
