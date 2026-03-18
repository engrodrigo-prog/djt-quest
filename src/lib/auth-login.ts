export const MATRICULA_LOOKUP_MIN_LENGTH = 6;

export type LoginInputMode = "text" | "numeric" | "email";
export type LoginQueryKind = "empty" | "matricula" | "email" | "name";

export interface LoginLookupUser {
  id?: string;
  name?: string;
  email?: string;
  matricula?: string | null;
}

export interface LoginQueryState {
  trimmed: string;
  normalized: string;
  digitsOnly: string;
  nameTokens: string[];
  kind: LoginQueryKind;
  allowSuggestions: boolean;
  inputMode: LoginInputMode;
}

export type LoginResolution<T extends LoginLookupUser> =
  | { kind: "matched"; user: T }
  | { kind: "needs_selection"; suggestions: T[] }
  | { kind: "needs_more_input" }
  | { kind: "not_found" };

export const normalizeMatricula = (value?: string | null) =>
  (value ?? "").replace(/\D/g, "");

export const getLoginQueryState = (value: string): LoginQueryState => {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  const digitsOnly = normalizeMatricula(trimmed);
  const nameTokens = normalized.split(/\s+/).filter(Boolean);
  const isEmail = normalized.includes("@");
  const isMatricula = !!digitsOnly && /^[0-9]+$/.test(digitsOnly);

  return {
    trimmed,
    normalized,
    digitsOnly,
    nameTokens,
    kind: !trimmed ? "empty" : isMatricula ? "matricula" : isEmail ? "email" : "name",
    allowSuggestions:
      (isMatricula && digitsOnly.length >= MATRICULA_LOOKUP_MIN_LENGTH) ||
      (isEmail && normalized.length >= 3) ||
      (!isMatricula && !isEmail && nameTokens.length >= 2 && nameTokens[1].length >= 1),
    inputMode: isEmail ? "email" : isMatricula ? "numeric" : "text",
  };
};

const uniqueExactName = <T extends LoginLookupUser>(users: T[], name: string) => {
  const matches = users.filter((user) => String(user.name || "").trim().toLowerCase() === name);
  return matches.length === 1 ? matches[0] : null;
};

const exactEmail = <T extends LoginLookupUser>(users: T[], email: string) =>
  users.find((user) => String(user.email || "").trim().toLowerCase() === email) ?? null;

export const resolveLoginCandidate = <T extends LoginLookupUser>(
  state: LoginQueryState,
  matches: {
    exactMatricula?: T[];
    partialMatricula?: T[];
    email?: T[];
    name?: T[];
  }
): LoginResolution<T> => {
  if (state.kind === "empty") return { kind: "not_found" };

  if (state.kind === "matricula") {
    if (state.digitsOnly.length < MATRICULA_LOOKUP_MIN_LENGTH) {
      return { kind: "needs_more_input" };
    }

    if (matches.exactMatricula?.[0]) {
      return { kind: "matched", user: matches.exactMatricula[0] };
    }

    if (matches.partialMatricula?.length) {
      return { kind: "needs_selection", suggestions: matches.partialMatricula };
    }

    return { kind: "not_found" };
  }

  if (state.kind === "email") {
    if (state.normalized.length < 3) {
      return { kind: "needs_more_input" };
    }

    const emailMatch = exactEmail(matches.email || [], state.normalized);
    if (emailMatch) return { kind: "matched", user: emailMatch };
    if ((matches.email || []).length === 1) return { kind: "matched", user: matches.email![0] };
    if ((matches.email || []).length > 1) return { kind: "needs_selection", suggestions: matches.email! };
    return { kind: "not_found" };
  }

  if (state.nameTokens.length < 2 || state.nameTokens[1].length < 1) {
    return { kind: "needs_more_input" };
  }

  const nameMatch = uniqueExactName(matches.name || [], state.normalized);
  if (nameMatch) return { kind: "matched", user: nameMatch };
  if ((matches.name || []).length === 1) return { kind: "matched", user: matches.name![0] };
  if ((matches.name || []).length > 1) return { kind: "needs_selection", suggestions: matches.name! };
  return { kind: "not_found" };
};
