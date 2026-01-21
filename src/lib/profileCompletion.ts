type ProfileCompletionStatus = {
  isExternal: boolean;
  missingAvatar: boolean;
  missingDob: boolean;
  missingEmail: boolean;
  missingMatricula: boolean;
  missingOperationalBase: boolean;
};

const normalizeFlag = (value: unknown) => String(value ?? "").trim().toUpperCase();

export const isExternalProfile = (profile: any): boolean => {
  return (
    ["EXTERNO", "CONVIDADOS"].includes(normalizeFlag(profile?.team_id)) ||
    ["EXTERNO", "CONVIDADOS"].includes(normalizeFlag(profile?.sigla_area)) ||
    ["EXTERNO", "CONVIDADOS"].includes(normalizeFlag(profile?.operational_base))
  );
};

export const getProfileCompletionStatus = (profile: any): ProfileCompletionStatus => {
  const isExternal = isExternalProfile(profile);

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
  // Always enforce explicit flags (security + onboarding).
  if (profile?.must_change_password) return true;
  if (profile?.needs_profile_completion) return true;

  const status = getProfileCompletionStatus(profile);

  // Convidados/externos não devem ficar bloqueados do app por campos faltantes.
  // Se precisar exigir algo para um convidado, use `needs_profile_completion=true`.
  if (status.isExternal) return false;

  const missingRequired =
    status.missingAvatar ||
    status.missingDob ||
    status.missingEmail ||
    status.missingMatricula ||
    status.missingOperationalBase;
  return missingRequired;
};
