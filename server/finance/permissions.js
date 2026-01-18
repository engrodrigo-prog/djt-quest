import { FINANCE_ANALYST_ROLE } from './constants.js';

const normalizeTeamId = (raw) => String(raw || '').trim().toUpperCase();
const isGuestTeamId = (raw) => normalizeTeamId(raw) === 'CONVIDADOS';

export const isGuestProfile = (p, roles = []) => {
  if (Array.isArray(roles) && roles.includes('invited')) return true;
  return (
    isGuestTeamId(p?.team_id) ||
    isGuestTeamId(p?.sigla_area) ||
    isGuestTeamId(p?.operational_base) ||
    isGuestTeamId(p?.coord_id) ||
    isGuestTeamId(p?.division_id)
  );
};

const normalizeNameKey = (name) =>
  String(name || '')
    .toLowerCase()
    .normalize('NFD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const isFinanceAnalystByProfile = (profile) => {
  const key = normalizeNameKey(profile?.name);
  return (
    (key.includes('cintia') && key.includes('veiga')) ||
    key.includes('roseli') ||
    key.includes('michelle') ||
    key.includes('italo')
  );
};

export const isFinanceAnalyst = (roles = [], profile) => {
  const set = new Set((roles || []).map((r) => String(r || '').trim()));
  if (set.has(FINANCE_ANALYST_ROLE)) return true;
  if (profile && isFinanceAnalystByProfile(profile)) return true;
  return false;
};

export const canManageFinanceRequests = (roles = [], profile) => {
  const set = new Set((roles || []).map((r) => String(r || '').trim()));
  if (set.has('admin')) return true;
  if (set.has('gerente_djt') || set.has('gerente')) return true;
  if (set.has('gerente_divisao_djtx') || set.has('lider_divisao')) return true;
  if (set.has('coordenador_djtx') || set.has('coordenador')) return true;
  if (set.has('lider_equipe')) return true;
  if (isFinanceAnalyst(roles, profile)) return true;
  if (profile?.is_leader) return true;
  return false;
};

export const canPurgeFinanceRequests = (roles = []) => {
  const set = new Set((roles || []).map((r) => String(r || '').trim()));
  return set.has('admin');
};
