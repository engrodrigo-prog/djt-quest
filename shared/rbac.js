/**
 * Shared RBAC constants/helpers for both frontend (Vite) and backend (Node).
 *
 * Conventions:
 * - Roles are stored in DB as lower-case strings (user_roles.role).
 * - "Leader" in product maps to one or more internal roles (team leader + coordinator/manager).
 */

export const ROLE = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'gerente_djt',
  DIV_MANAGER: 'gerente_divisao_djtx',
  COORD: 'coordenador_djtx',
  TEAM_LEADER: 'lider_equipe',
  COLLAB: 'colaborador',
  INVITED: 'invited',
  CONTENT_CURATOR: 'content_curator',
});

export const ROLE_ALIASES = Object.freeze({
  gerente: ROLE.MANAGER,
  lider_divisao: ROLE.DIV_MANAGER,
  coordenador: ROLE.COORD,
});

export const STUDIO_ALLOWED_ROLES = Object.freeze([
  ROLE.COORD,
  ROLE.DIV_MANAGER,
  ROLE.MANAGER,
  ROLE.ADMIN,
  'coordenador',
  'lider_divisao',
  'gerente',
  ROLE.TEAM_LEADER,
  ROLE.CONTENT_CURATOR,
]);

export function normalizeRole(raw) {
  const r = String(raw || '').trim();
  if (!r) return '';
  return ROLE_ALIASES[r] || r;
}

export function rolesToSet(rowsOrRoles) {
  const set = new Set();
  if (Array.isArray(rowsOrRoles)) {
    for (const item of rowsOrRoles) {
      const r = typeof item === 'string' ? item : item?.role;
      const nr = normalizeRole(r);
      if (nr) set.add(nr);
    }
  }
  return set;
}

export function hasRole(roleSet, role) {
  return Boolean(roleSet && roleSet.has(role));
}

export function isAdmin(roleSet) {
  return hasRole(roleSet, ROLE.ADMIN);
}

export function isContentCurator(roleSet) {
  return hasRole(roleSet, ROLE.CONTENT_CURATOR);
}

export function isLeaderRole(roleSet) {
  return (
    hasRole(roleSet, ROLE.TEAM_LEADER) ||
    hasRole(roleSet, ROLE.MANAGER) ||
    hasRole(roleSet, ROLE.DIV_MANAGER) ||
    hasRole(roleSet, ROLE.COORD)
  );
}

export function canAssignRoles(params) {
  const roleSet = params?.roleSet;
  const profile = params?.profile || {};
  // Legacy: some environments still rely on profiles.is_leader / studio_access.
  return isAdmin(roleSet) || isLeaderRole(roleSet) || Boolean(profile?.is_leader);
}

export function canCurate(roleSet) {
  // Back-compat:
  // - Old callsites pass only roleSet (Set).
  // - New callsites may pass { roleSet, profile } to support "invited curator" via profiles.studio_access.
  if (roleSet instanceof Set) {
    return isAdmin(roleSet) || isContentCurator(roleSet);
  }
  const input = roleSet || {};
  const set = input?.roleSet instanceof Set ? input.roleSet : rolesToSet(input?.roleSet);
  const profile = input?.profile || {};
  if (isAdmin(set) || isContentCurator(set)) return true;
  // Guests can be granted "curation-only" Studio access via profile flag (see UserManagement UI hint).
  return Boolean(profile?.studio_access) && hasRole(set, ROLE.INVITED);
}

export function canSeeAnswerKey(params) {
  const roleSet = params?.roleSet;
  const isOwner = Boolean(params?.isOwner);
  return isAdmin(roleSet) || isContentCurator(roleSet) || isOwner;
}

export function studioLandingPath(params) {
  const roleSet = params?.roleSet;
  if (isContentCurator(roleSet) && !isAdmin(roleSet)) return '/studio/curadoria';
  return '/studio';
}
