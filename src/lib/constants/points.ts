// DJT aggregate group (kept permissive for backwards-compat with legacy IDs).
export const DJT_TEAM_GROUP_IDS = ["DJT", "DJT-PLAN", "DJT-PLA", "PLA"] as const;

export const isDjtTeamGroupId = (teamId: string | null | undefined) =>
  DJT_TEAM_GROUP_IDS.includes(String(teamId || "").trim().toUpperCase() as any);

export const normalizeTeamId = (teamId: string | null | undefined) =>
  String(teamId || "").trim().toUpperCase();

const TEAM_SCOPE_EXTRAS: Record<string, string[]> = {
  // Legacy: DJT-PLA / PLA (older org ids) should still be visible under DJT scope.
  DJT: ["DJT-PLAN", "DJT-PLA", "PLA"],
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
