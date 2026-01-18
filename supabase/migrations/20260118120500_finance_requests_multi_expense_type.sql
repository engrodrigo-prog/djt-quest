-- Finance Requests: allow summary expense_type for multi-item reimbursements.
-- This keeps legacy UX (single expense_type) while enabling "Múltiplos" as a safe summary.

alter table public.finance_requests
  drop constraint if exists finance_requests_expense_type_check;

alter table public.finance_requests
  add constraint finance_requests_expense_type_check
  check (expense_type in (
    'Transporte',
    'Quilometragem',
    'Abastecimento/Pedágio',
    'Estacionamento',
    'Jantar',
    'Hospedagem/Café da Manhã',
    'Materiais',
    'Serviços',
    'Adiantamento',
    'Múltiplos'
  ));
