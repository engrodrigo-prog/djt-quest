-- Finance Requests: reimbursements / advances (reembolso/adiantamento)
-- Feature: "Solicitar Reembolso ou Adiantamento"

-- Needed for robust name matching in analyst role assignment
create extension if not exists unaccent;

-- Requests table
create table if not exists public.finance_requests (
  id uuid primary key default gen_random_uuid(),
  protocol text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_by_name text,
  created_by_email text,
  created_by_matricula text,

  company text not null,
  training_operational boolean not null default false,
  request_kind text not null, -- Reembolso | Adiantamento
  expense_type text not null, -- Transporte | ... | Adiantamento
  coordination text not null,
  date_start date not null,
  date_end date,
  description text not null,
  amount_cents integer, -- BRL cents; optional for Adiantamento per product rule
  currency text not null default 'BRL',

  status text not null default 'Enviado', -- Enviado | Em análise | Aprovado | Reprovado | Pago | Cancelado
  last_observation text
);

create index if not exists idx_finance_requests_created_by on public.finance_requests (created_by);
create index if not exists idx_finance_requests_status on public.finance_requests (status);
create index if not exists idx_finance_requests_date_start on public.finance_requests (date_start);
create index if not exists idx_finance_requests_updated_at on public.finance_requests (updated_at);

-- Attachments table
create table if not exists public.finance_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.finance_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles(id) on delete set null,
  url text not null,
  storage_bucket text,
  storage_path text,
  filename text,
  content_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_finance_request_attachments_request on public.finance_request_attachments (request_id);

-- Status history table
create table if not exists public.finance_request_status_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.finance_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null,
  from_status text,
  to_status text not null,
  observation text
);

create index if not exists idx_finance_request_status_history_request on public.finance_request_status_history (request_id);

-- Constraints (conservative)
alter table public.finance_requests
  add constraint finance_requests_company_check
  check (company in ('CPFL Piratininga', 'CPFL Santa Cruz'));

alter table public.finance_requests
  add constraint finance_requests_request_kind_check
  check (request_kind in ('Reembolso', 'Adiantamento'));

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
    'Adiantamento'
  ));

alter table public.finance_requests
  add constraint finance_requests_coordination_check
  check (coordination in (
    'Santos',
    'Cubatão',
    'Piraju',
    'Itapetininga',
    'Sudeste',
    'Sul',
    'Planejamento',
    'DJTV (Coordenadores)',
    'DJTB (Coordenadores)',
    'DJT (Gerentes + Coordenadora)'
  ));

alter table public.finance_requests
  add constraint finance_requests_status_check
  check (status in ('Enviado','Em análise','Aprovado','Reprovado','Pago','Cancelado'));

alter table public.finance_requests
  add constraint finance_requests_date_end_check
  check (date_end is null or date_end >= date_start);

alter table public.finance_requests
  add constraint finance_requests_description_len_check
  check (length(description) between 10 and 5000);

alter table public.finance_requests
  add constraint finance_requests_observation_len_check
  check (last_observation is null or length(last_observation) <= 2000);

-- Rule: if request_kind = Adiantamento => expense_type must be Adiantamento
--       if request_kind = Reembolso   => expense_type cannot be Adiantamento
alter table public.finance_requests
  add constraint finance_requests_kind_vs_type_check
  check (
    (request_kind = 'Adiantamento' and expense_type = 'Adiantamento')
    or
    (request_kind = 'Reembolso' and expense_type <> 'Adiantamento')
  );

-- Conservative amount constraint:
-- - For Reembolso: amount required and > 0
-- - For Adiantamento: amount optional (per UI); if provided must be > 0
alter table public.finance_requests
  add constraint finance_requests_amount_check
  check (
    (request_kind = 'Reembolso' and amount_cents is not null and amount_cents > 0)
    or
    (request_kind = 'Adiantamento' and (amount_cents is null or amount_cents > 0))
  );

-- Protocol generator
create or replace function public.generate_finance_protocol()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  stamp text;
  rand text;
begin
  stamp := to_char(now(), 'YYYYMMDD-HH24MISS');
  rand := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4));
  return format('FIN-%s-%s', stamp, rand);
end;
$$;

create or replace function public.trg_finance_requests_set_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.protocol is null or length(trim(new.protocol)) = 0 then
    new.protocol := public.generate_finance_protocol();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_finance_requests_defaults on public.finance_requests;
create trigger trg_finance_requests_defaults
before insert or update on public.finance_requests
for each row execute function public.trg_finance_requests_set_defaults();

-- Enable RLS
alter table public.finance_requests enable row level security;
alter table public.finance_request_attachments enable row level security;
alter table public.finance_request_status_history enable row level security;

-- Policies
drop policy if exists "FinanceRequests: select own or staff" on public.finance_requests;
create policy "FinanceRequests: select own or staff"
on public.finance_requests for select
to authenticated
using (
  created_by = (select auth.uid())
  or public.has_role((select auth.uid()), 'admin')
  or public.has_role((select auth.uid()), 'gerente_djt')
  or public.has_role((select auth.uid()), 'gerente_divisao_djtx')
  or public.has_role((select auth.uid()), 'coordenador_djtx')
  or public.has_role((select auth.uid()), 'lider_equipe')
  or public.has_role((select auth.uid()), 'analista_financeiro')
);

drop policy if exists "FinanceRequests: insert own" on public.finance_requests;
create policy "FinanceRequests: insert own"
on public.finance_requests for insert
to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists "FinanceRequests: update owner cancel or staff" on public.finance_requests;
create policy "FinanceRequests: update owner cancel or staff"
on public.finance_requests for update
to authenticated
using (
  created_by = (select auth.uid())
  or public.has_role((select auth.uid()), 'admin')
  or public.has_role((select auth.uid()), 'gerente_djt')
  or public.has_role((select auth.uid()), 'gerente_divisao_djtx')
  or public.has_role((select auth.uid()), 'coordenador_djtx')
  or public.has_role((select auth.uid()), 'lider_equipe')
  or public.has_role((select auth.uid()), 'analista_financeiro')
)
with check (true);

drop policy if exists "FinanceAttachments: select via request access" on public.finance_request_attachments;
create policy "FinanceAttachments: select via request access"
on public.finance_request_attachments for select
to authenticated
using (
  exists (
    select 1 from public.finance_requests fr
    where fr.id = finance_request_attachments.request_id
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

drop policy if exists "FinanceAttachments: insert by owner or staff" on public.finance_request_attachments;
create policy "FinanceAttachments: insert by owner or staff"
on public.finance_request_attachments for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.finance_requests fr
    where fr.id = finance_request_attachments.request_id
      and fr.created_by = (select auth.uid())
  )
);

drop policy if exists "FinanceStatusHistory: select via request access" on public.finance_request_status_history;
create policy "FinanceStatusHistory: select via request access"
on public.finance_request_status_history for select
to authenticated
using (
  exists (
    select 1 from public.finance_requests fr
    where fr.id = finance_request_status_history.request_id
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

drop policy if exists "FinanceStatusHistory: insert by staff" on public.finance_request_status_history;
create policy "FinanceStatusHistory: insert by staff"
on public.finance_request_status_history for insert
to authenticated
with check (
  public.has_role((select auth.uid()), 'admin')
  or public.has_role((select auth.uid()), 'gerente_djt')
  or public.has_role((select auth.uid()), 'gerente_divisao_djtx')
  or public.has_role((select auth.uid()), 'coordenador_djtx')
  or public.has_role((select auth.uid()), 'lider_equipe')
  or public.has_role((select auth.uid()), 'analista_financeiro')
);

-- Assign finance analyst role to specific users (best-effort, idempotent).
insert into public.user_roles(user_id, role)
select p.id, 'analista_financeiro'
from public.profiles p
where (
  unaccent(lower(coalesce(p.name,''))) like '%cintia%veiga%'
  or unaccent(lower(coalesce(p.name,''))) like '%roseli%'
  or unaccent(lower(coalesce(p.name,''))) like '%michelle%'
  or unaccent(lower(coalesce(p.name,''))) like '%italo%'
)
on conflict do nothing;
