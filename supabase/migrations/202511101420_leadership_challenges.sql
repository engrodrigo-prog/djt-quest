-- Leadership challenges and scheduling/OKR support
alter table public.challenges
  add column if not exists audience text check (audience in ('all','leaders')) default 'all',
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists start_date timestamptz,
  add column if not exists due_date timestamptz,
  add column if not exists allow_early boolean default true,
  add column if not exists allow_late boolean default false,
  add column if not exists status text check (status in ('active','scheduled','canceled','closed')) default 'active',
  add column if not exists canceled_at timestamptz,
  add column if not exists okr_key text,
  add column if not exists project_code text;

create table if not exists public.leadership_challenge_assignments (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  due_date timestamptz,
  completed_at timestamptz,
  status text not null default 'assigned' check (status in ('assigned','completed','canceled')),
  unique (challenge_id, user_id)
);

alter table public.leadership_challenge_assignments enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leadership_challenge_assignments' and policyname='LCA: self read') then
    create policy "LCA: self read" on public.leadership_challenge_assignments for select using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leadership_challenge_assignments' and policyname='LCA: self update complete') then
    create policy "LCA: self update complete" on public.leadership_challenge_assignments for update using (user_id = (select auth.uid()));
  end if;
end $$;

