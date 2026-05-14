export const FINANCE_COMPANIES = ['CPFL Piratininga', 'CPFL Santa Cruz'] as const;
export const FINANCE_REQUEST_KINDS = ['Reembolso', 'Adiantamento'] as const;
export const FINANCE_EXPENSE_TYPES = [
  'Transporte',
  'Quilometragem',
  'Abastecimento/Pedágio',
  'Estacionamento',
  'Almoço',
  'Jantar',
  'Hospedagem/Café da Manhã',
  'Materiais',
  'Serviços',
  'Outros',
] as const;
export const FINANCE_COORDINATIONS = [
  'Santos',
  'Cubatão',
  'Piraju',
  'Itapetininga',
  'Sudeste',
  'Sul',
  'Planejamento',
  'DJTV (Coordenadores)',
  'DJTB (Coordenadores)',
  'DJT (Gerentes + Coordenadora)',
] as const;

// Canonical statuses (DB). Legacy values are normalized in code when needed.
export const FINANCE_STATUSES = ['Enviado', 'Em Análise', 'Aprovado', 'Reprovado', 'Cancelado'] as const;

export type FinanceStatus = (typeof FINANCE_STATUSES)[number];

export const normalizeFinanceStatus = (raw: unknown): string => {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s === 'Em análise') return 'Em Análise';
  if (s === 'Pago') return 'Aprovado';
  return s;
};
