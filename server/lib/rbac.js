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

export function normalizeRole(raw) {
  const r = String(raw || '').trim();
  if (!r) return '';
  return ROLE_ALIASES[r] || r;
}

export function rolesToSet(rows) {
  const set = new Set();
  for (const row of rows || []) {
    const r = normalizeRole(row?.role);
    if (r) set.add(r);
  }
  return set;
}

export function hasRole(roleSet, role) {
  return Boolean(roleSet && roleSet.has(role));
}

export function isAdmin(roleSet) {
  return hasRole(roleSet, ROLE.ADMIN);
}

export function canCurate(roleSet) {
  return hasRole(roleSet, ROLE.CONTENT_CURATOR) || hasRole(roleSet, ROLE.ADMIN);
}

export function canManageUsers(roleSet) {
  return (
    hasRole(roleSet, ROLE.ADMIN) ||
    hasRole(roleSet, ROLE.MANAGER) ||
    hasRole(roleSet, ROLE.DIV_MANAGER) ||
    hasRole(roleSet, ROLE.COORD)
  );
}

export function canAccessStudio(params) {
  const roleSet = params?.roleSet;
  const profile = params?.profile || {};
  return (
    Boolean(profile?.studio_access) ||
    Boolean(profile?.is_leader) ||
    hasRole(roleSet, ROLE.TEAM_LEADER) ||
    canManageUsers(roleSet) ||
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
