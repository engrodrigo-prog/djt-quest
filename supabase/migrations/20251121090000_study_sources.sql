-- Study sources for AI-powered quizzes

create table if not exists public.study_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('text','url','file','youtube')),
  url text,
  storage_path text,
  summary text,
  full_text text,
  is_persistent boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.study_sources enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: owner read') then
    create policy "StudySources: owner read" on public.study_sources
      for select using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: owner write') then
    create policy "StudySources: owner write" on public.study_sources
      for all using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: leaders read all') then
    create policy "StudySources: leaders read all" on public.study_sources
      for select using (
        user_id = (select auth.uid())
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = (select auth.uid())
            and ur.role in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
        )
      );
  end if;
end $$;
