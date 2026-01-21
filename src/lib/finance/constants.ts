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
export const FINANCE_STATUSES = ['Enviado', 'Em Análise', 'Aprovado', 'Reprovado', 'Cancelado'] as const;

export const normalizeFinanceStatus = (raw: unknown): string => {
  const status = String(raw ?? '').trim();
  if (status === 'Em análise') return 'Em Análise';
  if (status === 'Pago') return 'Aprovado';
  return status;
};

export const financeStatusBadgeClassName = (raw: unknown): string => {
  const status = normalizeFinanceStatus(raw);
  if (status === 'Enviado') return 'border-transparent bg-blue-600 text-white';
  if (status === 'Em Análise') return 'border-transparent bg-orange-500 text-white';
  if (status === 'Aprovado') return 'border-transparent bg-green-600 text-white';
  if (status === 'Reprovado' || status === 'Cancelado') return 'border-transparent bg-red-600 text-white';
  return 'border-transparent bg-muted text-foreground';
};
