export { ROLE, ROLE_ALIASES, normalizeRole, rolesToSet, hasRole, isAdmin, canCurate, canSeeAnswerKey, studioLandingPath, STUDIO_ALLOWED_ROLES } from '../../shared/rbac.js';

import { ROLE, normalizeRole, rolesToSet, hasRole, isAdmin, canCurate, canAssignRoles } from '../../shared/rbac.js';

export function canManageUsers(params) {
  // Kept for compatibility with existing code (previously accepted only roleSet).
  if (params instanceof Set) return canAssignRoles({ roleSet: params, profile: {} });
  const roleSet = params?.roleSet;
  const profile = params?.profile || {};
  return canAssignRoles({ roleSet, profile });
}

export function canAccessStudio(params) {
  const roleSet = params?.roleSet;
  const profile = params?.profile || {};
  return (
    Boolean(profile?.studio_access) ||
    Boolean(profile?.is_leader) ||
    hasRole(roleSet, ROLE.TEAM_LEADER) ||
    canManageUsers({ roleSet, profile }) ||
    canCurate(roleSet)
  );
}

export function sanitizeRoleList(raw) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const nr = normalizeRole(r);
    if (nr) out.push(nr);
  }
  return Array.from(new Set(out));
}
