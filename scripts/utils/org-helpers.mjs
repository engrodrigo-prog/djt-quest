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

  for (const org of entries) {
    if (!org) continue;
    if (!divisions.has(org.divisionId)) {
      divisions.set(org.divisionId, {
        id: org.divisionId,
        name: org.divisionName,
        department_id: 'DJT',
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
        coordination_id: org.coordinationId,
      });
    }
  }

  return {
    divisions: Array.from(divisions.values()),
    coordinations: Array.from(coordinations.values()),
    teams: Array.from(teams.values()),
  };
}
