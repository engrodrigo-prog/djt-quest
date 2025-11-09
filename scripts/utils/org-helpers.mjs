const DEPARTMENT_ID = 'd1111111-1111-1111-1111-111111111111';
const DEPARTMENT_NAME = 'DJT - Subtransmissão CPFL';

export function deriveOrgUnits(rawSigla) {
  if (!rawSigla) return null;
  const normalized = rawSigla
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) return null;

  const parts = normalized.split('-').filter(Boolean);
  const divisionId = parts[0] || 'DJT';
  const divisionName = `Divisão ${divisionId}`;

  const coordinationTag = parts[1] || 'SEDE';
  const coordinationId = `${divisionId}-${coordinationTag}`;
  const coordinationName = `${divisionId} ${coordinationTag}`;

  const teamId = normalized;
  const teamName = `Equipe ${normalized}`;

  return {
    departmentId: DEPARTMENT_ID,
    departmentName: DEPARTMENT_NAME,
    divisionId,
    divisionName,
    coordinationId,
    coordinationName,
    teamId,
    teamName,
  };
}

export function buildOrgUpserts(entries) {
  const divisions = new Map();
  const coordinations = new Map();
  const teams = new Map();
  const departments = new Map();

  for (const org of entries) {
    if (!org) continue;
    if (!departments.has(DEPARTMENT_ID)) {
      departments.set(DEPARTMENT_ID, {
        id: DEPARTMENT_ID,
        name: DEPARTMENT_NAME,
      });
    }
    if (!divisions.has(org.divisionId)) {
      divisions.set(org.divisionId, {
        id: org.divisionId,
        name: org.divisionName,
        // Older schema requires department_id UUID; we reference the seeded constant.
        department_id: DEPARTMENT_ID,
      });
    }
    if (!coordinations.has(org.coordinationId)) {
      coordinations.set(org.coordinationId, {
        id: org.coordinationId,
        name: org.coordinationName,
        division_id: org.divisionId,
      });
    }
    if (!teams.has(org.teamId)) {
      teams.set(org.teamId, {
        id: org.teamId,
        name: org.teamName,
        // Newer schema uses coord_id; alignment migration ensures compat.
        coord_id: org.coordinationId,
      });
    }
  }

  return {
    departments: Array.from(departments.values()),
    divisions: Array.from(divisions.values()),
    coordinations: Array.from(coordinations.values()),
    teams: Array.from(teams.values()),
  };
}
