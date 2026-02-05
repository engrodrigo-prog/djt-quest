-- Finance Requests: line items (multi-motive / multi-value)
-- Adds `finance_request_items` and links attachments to an item via `item_id`.

create table if not exists public.finance_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.finance_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  idx integer not null default 0,
  expense_type text not null,
  description text not null,
  amount_cents integer,
  currency text not null default 'BRL',
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists uq_finance_request_items_request_idx
  on public.finance_request_items (request_id, idx);
create index if not exists idx_finance_request_items_request
  on public.finance_request_items (request_id);
alter table public.finance_request_items
  add constraint finance_request_items_expense_type_check
  check (expense_type in (
    'Transporte',
    'Quilometragem',
    'Abastecimento/Pedágio',
    'Estacionamento',
    'Jantar',
    'Hospedagem/Café da Manhã',
    'Materiais',
    'Serviços',
    'Adiantamento'
  ));
-- If expense_type = Adiantamento => amount optional (but positive if set)
-- If expense_type != Adiantamento => amount required and > 0
alter table public.finance_request_items
  add constraint finance_request_items_amount_check
  check (
    (expense_type = 'Adiantamento' and (amount_cents is null or amount_cents > 0))
    or
    (expense_type <> 'Adiantamento' and amount_cents is not null and amount_cents > 0)
  );
alter table public.finance_request_items
  add constraint finance_request_items_description_len_check
  check (length(description) between 1 and 2000);
-- Link attachments to items (optional; legacy attachments will have NULL item_id)
alter table public.finance_request_attachments
  add column if not exists item_id uuid references public.finance_request_items(id) on delete set null;
create index if not exists idx_finance_request_attachments_item
  on public.finance_request_attachments (item_id);
-- Enable RLS
alter table public.finance_request_items enable row level security;
-- Policies
drop policy if exists "FinanceItems: select via request access" on public.finance_request_items;
create policy "FinanceItems: select via request access"
on public.finance_request_items for select
to authenticated
using (
  exists (
    select 1 from public.finance_requests fr
    where fr.id = finance_request_items.request_id
      and (
        fr.created_by = (select auth.uid())
        or public.has_role((select auth.uid()), 'admin')
        or public.has_role((select auth.uid()), 'gerente_djt')
        or public.has_role((select auth.uid()), 'gerente_divisao_djtx')
        or public.has_role((select auth.uid()), 'coordenador_djtx')
        or public.has_role((select auth.uid()), 'lider_equipe')
        or public.has_role((select auth.uid()), 'analista_financeiro')
      )
  )
);
drop policy if exists "FinanceItems: insert by owner or staff" on public.finance_request_items;
create policy "FinanceItems: insert by owner or staff"
on public.finance_request_items for insert
to authenticated
with check (
  exists (
    select 1 from public.finance_requests fr
    where fr.id = finance_request_items.request_id
      and (
        fr.created_by = (select auth.uid())
        or public.has_role((select auth.uid()), 'admin')
        or public.has_role((select auth.uid()), 'gerente_djt')
        or public.has_role((select auth.uid()), 'gerente_divisao_djtx')
        or public.has_role((select auth.uid()), 'coordenador_djtx')
        or public.has_role((select auth.uid()), 'lider_equipe')
        or public.has_role((select auth.uid()), 'analista_financeiro')
      )
  )
);
