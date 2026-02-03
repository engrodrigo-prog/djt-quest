const ADMIN_EMAILS = new Set(['rodrigonasc@cpfl.com.br', 'cveiga@cpfl.com.br']);
const ADMIN_MATRICULAS = new Set(['601555', '600001']);

const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const normalizeMatricula = (value: unknown) => String(value ?? '').trim();

export function isAllowlistedAdmin(input: { email?: unknown; matricula?: unknown } | null | undefined) {
  const email = normalizeEmail((input as any)?.email);
  const matricula = normalizeMatricula((input as any)?.matricula);
  return Boolean((email && ADMIN_EMAILS.has(email)) || (matricula && ADMIN_MATRICULAS.has(matricula)));
}

export function isAllowlistedAdminFromProfile(profile: any | null | undefined) {
  return isAllowlistedAdmin({ email: profile?.email, matricula: profile?.matricula });
}

