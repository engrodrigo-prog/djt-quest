-- StudyLab Knowledge Catalog: categories + org publishing + metadata

alter table if exists public.study_sources
  add column if not exists category text default 'OUTROS',
  add column if not exists scope text default 'user',
  add column if not exists published boolean default false,
  add column if not exists metadata jsonb default '{}'::jsonb;

-- Backfill nulls (defensive)
update public.study_sources
set category = coalesce(category, 'OUTROS'),
    scope = coalesce(scope, 'user'),
    published = coalesce(published, false),
    metadata = coalesce(metadata, '{}'::jsonb)
where category is null
   or scope is null
   or published is null
   or metadata is null;

-- Constraints (enforce fixed catalog list)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'study_sources_category_check') then
    alter table public.study_sources
      add constraint study_sources_category_check
      check (
        category in (
          'MANUAIS',
          'PROCEDIMENTOS',
          'APOSTILAS',
          'RELATORIO_OCORRENCIA',
          'AUDITORIA_INTERNA',
          'AUDITORIA_EXTERNA',
          'OUTROS'
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'study_sources_scope_check') then
    alter table public.study_sources
      add constraint study_sources_scope_check
      check (scope in ('user','org'));
  end if;
end $$;

-- RLS: tighten "owner write" so normal users cannot publish to org.
-- Also add a public org catalog (read-only for collaborators; writable for leadership).
do $$ begin
  -- Drop legacy permissive owner policies (names used in older migrations)
  execute 'drop policy if exists "StudySources owner write" on public.study_sources';
  execute 'drop policy if exists "StudySources: owner write" on public.study_sources';
  execute 'drop policy if exists "StudySources owner read" on public.study_sources';
  execute 'drop policy if exists "StudySources: owner read" on public.study_sources';

  -- Recreate owner policies (private scope only)
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: owner read') then
    create policy "StudySources: owner read" on public.study_sources
      for select using (user_id = (select auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: owner write') then
    create policy "StudySources: owner write" on public.study_sources
      for all
      using (user_id = (select auth.uid()) and scope = 'user')
      with check (user_id = (select auth.uid()) and scope = 'user');
  end if;

  -- Public: allow everyone to read published org sources
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: org read published') then
    create policy "StudySources: org read published" on public.study_sources
      for select using (scope = 'org' and published = true);
  end if;

  -- Leadership: manage org catalog
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_sources' and policyname='StudySources: staff manage org') then
    create policy "StudySources: staff manage org" on public.study_sources
      for all
      using (
        scope = 'org'
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = (select auth.uid())
            and ur.role in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
        )
      )
      with check (
        scope = 'org'
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = (select auth.uid())
            and ur.role in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
        )
      );
  end if;
end $$;

