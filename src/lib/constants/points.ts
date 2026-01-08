export const DJT_TEAM_GROUP_IDS = ["DJT", "PLA", "DJT-PLA"] as const;

export const isDjtTeamGroupId = (teamId: string | null | undefined) =>
  DJT_TEAM_GROUP_IDS.includes(String(teamId || "").trim().toUpperCase() as any);

export const normalizeTeamId = (teamId: string | null | undefined) =>
  String(teamId || "").trim().toUpperCase();

const TEAM_SCOPE_EXTRAS: Record<string, string[]> = {
  // DJT should include PLA even though it is not a prefix child.
  DJT: ["PLA"],
};

export const buildTeamScope = (baseTeamId: string | null | undefined, allTeamIds: string[]) => {
  const base = normalizeTeamId(baseTeamId);
  const scope = new Set<string>();
  if (!base) return scope;

  scope.add(base);
  const prefix = `${base}-`;
  for (const teamId of Array.isArray(allTeamIds) ? allTeamIds : []) {
    const normalized = normalizeTeamId(teamId);
    if (normalized.startsWith(prefix)) scope.add(normalized);
  }

  const extras = TEAM_SCOPE_EXTRAS[base];
  if (Array.isArray(extras)) {
    for (const teamId of extras) scope.add(normalizeTeamId(teamId));
  }

  return scope;
};

// Backwards-compat helper (legacy DJT-only aggregate check).
export const isDjtTeamAggregateBaseId = (teamId: string | null | undefined) => normalizeTeamId(teamId) === "DJT";
