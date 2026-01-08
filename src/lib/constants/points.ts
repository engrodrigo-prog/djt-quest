export const DJT_TEAM_GROUP_IDS = ["DJT", "PLA", "DJT-PLA"] as const;

export const isDjtTeamGroupId = (teamId: string | null | undefined) =>
  DJT_TEAM_GROUP_IDS.includes(String(teamId || "").trim().toUpperCase() as any);

// Only the base DJT team should expand to include PLA + DJT-PLA members.
export const isDjtTeamAggregateBaseId = (teamId: string | null | undefined) =>
  String(teamId || "")
    .trim()
    .toUpperCase() === "DJT";
