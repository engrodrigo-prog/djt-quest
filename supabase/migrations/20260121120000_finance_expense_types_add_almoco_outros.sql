-- Finance Requests: expand expense types (Almoço, Outros).

alter table public.finance_requests
  drop constraint if exists finance_requests_expense_type_check;

alter table public.finance_requests
  add constraint finance_requests_expense_type_check
  check (expense_type in (
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
    'Adiantamento',
    'Múltiplos'
  ));

alter table public.finance_request_items
  drop constraint if exists finance_request_items_expense_type_check;

alter table public.finance_request_items
  add constraint finance_request_items_expense_type_check
  check (expense_type in (
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
    'Adiantamento'
  ));

