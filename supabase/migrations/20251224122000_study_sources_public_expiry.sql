-- StudyLab public/private visibility + expiry + suggested questions

alter table if exists public.study_sources
  add column if not exists expires_at timestamptz,
  add column if not exists access_count integer default 0;

update public.study_sources
set expires_at = coalesce(expires_at, now() + interval '7 days')
where scope = 'user';

update public.study_sources
set expires_at = null
where scope = 'org';

-- Public read for all, owner manage all, staff manage public
do $$ begin
  execute 'drop policy if exists "StudySources: owner write" on public.study_sources';
  execute 'drop policy if exists "StudySources: owner read" on public.study_sources';
  execute 'drop policy if exists "StudySources: leaders read all" on public.study_sources';
  execute 'drop policy if exists "StudySources: org read published" on public.study_sources';
  execute 'drop policy if exists "StudySources: staff manage org" on public.study_sources';

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: owner manage') then
    create policy "StudySources: owner manage" on public.study_sources
      for all
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: public read') then
    create policy "StudySources: public read" on public.study_sources
      for select using (scope = 'org' and published = true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: staff manage public') then
    create policy "StudySources: staff manage public" on public.study_sources
      for all
      using (
        scope = 'org'
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = (select auth.uid())
            and ur.role::text in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
        )
      )
      with check (
        scope = 'org'
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = (select auth.uid())
            and ur.role::text in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
        )
      );
  end if;
end $$;

-- Track access (for "mais acessados")
create or replace function public.increment_study_source_access(p_source_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.study_sources
  set access_count = coalesce(access_count, 0) + 1,
      last_used_at = now()
  where id = p_source_id;
$$;

grant execute on function public.increment_study_source_access(uuid) to public;

-- Suggested questions generated during ingest
create table if not exists public.study_source_questions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.study_sources(id) on delete cascade not null,
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  answer_index integer,
  explanation text,
  difficulty text default 'basico',
  tags text[] default '{}'::text[],
  created_at timestamptz not null default now()
);

alter table public.study_source_questions enable row level security;

create policy "StudySourceQuestions: read public or own" on public.study_source_questions
  for select
  using (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and (ss.user_id = (select auth.uid()) or (ss.scope = 'org' and ss.published = true))
    )
  );

create policy "StudySourceQuestions: owner manage" on public.study_source_questions
  for all
  using (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and ss.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and ss.user_id = (select auth.uid())
    )
  );

create index if not exists study_source_questions_source_idx on public.study_source_questions (source_id);
create index if not exists study_source_questions_created_idx on public.study_source_questions (created_at desc);
create index if not exists study_source_questions_tags_gin on public.study_source_questions using gin (tags);
