const ADMIN_EMAILS = new Set(['rodrigonasc@cpfl.com.br', 'cveiga@cpfl.com.br']);
const ADMIN_MATRICULAS = new Set(['601555', '600001']);

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeMatricula = (value) => String(value || '').trim();

export function isAllowlistedAdmin({ email, matricula } = {}) {
  const e = normalizeEmail(email);
  const m = normalizeMatricula(matricula);
  return Boolean((e && ADMIN_EMAILS.has(e)) || (m && ADMIN_MATRICULAS.has(m)));
}

