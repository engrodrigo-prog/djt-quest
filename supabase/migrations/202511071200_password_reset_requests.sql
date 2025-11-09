-- Password reset workflow
create type if not exists password_reset_status as enum ('pending','approved','rejected');

create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  identifier text not null,
  reason text,
  status password_reset_status not null default 'pending',
  requested_at timestamptz not null default now(),
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz,
  reviewer_notes text
);

create index if not exists idx_password_reset_requests_status on public.password_reset_requests(status);
create index if not exists idx_password_reset_requests_requested_at on public.password_reset_requests(requested_at desc);

alter table public.password_reset_requests enable row level security;

create policy if not exists "Users can view their password resets"
  on public.password_reset_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy if not exists "Leaders can review password resets"
  on public.password_reset_requests
  for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin') or
    public.has_role(auth.uid(), 'gerente_djt') or
    public.has_role(auth.uid(), 'gerente_divisao_djtx') or
    public.has_role(auth.uid(), 'coordenador_djtx')
  );
