export const DJT_TEAM_GROUP_IDS = ["DJT", "PLA", "DJT-PLA"] as const;

export const isDjtTeamGroupId = (teamId: string | null | undefined) =>
  DJT_TEAM_GROUP_IDS.includes(String(teamId || "").trim().toUpperCase() as any);
