type ProfileCompletionStatus = {
  isExternal: boolean;
  missingAvatar: boolean;
  missingDob: boolean;
  missingEmail: boolean;
  missingMatricula: boolean;
  missingOperationalBase: boolean;
};

const normalizeFlag = (value: unknown) => String(value ?? "").trim().toUpperCase();

export const getProfileCompletionStatus = (profile: any): ProfileCompletionStatus => {
  const isExternal =
    ["EXTERNO", "CONVIDADOS"].includes(normalizeFlag(profile?.sigla_area)) ||
    ["EXTERNO", "CONVIDADOS"].includes(normalizeFlag(profile?.operational_base));

  const avatarUrl = String(profile?.avatar_url || profile?.avatar_thumbnail_url || "").trim();
  const dob = String(profile?.date_of_birth || "").trim();
  const email = String(profile?.email || "").trim();
  const matricula = String(profile?.matricula || "").trim();
  const operationalBase = String(profile?.operational_base || "").trim();

  return {
    isExternal,
    missingAvatar: !avatarUrl,
    missingDob: !dob,
    missingEmail: !email,
    missingMatricula: !isExternal && !matricula,
    missingOperationalBase: !operationalBase,
  };
};

export const requiresProfileCompletion = (profile: any): boolean => {
  if (!profile) return false;
  const status = getProfileCompletionStatus(profile);
  const missingRequired =
    status.missingAvatar ||
    status.missingDob ||
    status.missingEmail ||
    status.missingMatricula ||
    status.missingOperationalBase;
  return Boolean(profile?.must_change_password || profile?.needs_profile_completion || missingRequired);
};
