-- Security hardening + policy consolidation

-- Move unaccent to extensions schema (linter: extension_in_public)
create schema if not exists extensions;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'unaccent') then
    if exists (
      select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'unaccent' and n.nspname = 'public'
    ) then
      alter extension unaccent set schema extensions;
    end if;
  else
    create extension if not exists unaccent with schema extensions;
  end if;
end $$;

-- Fix mutable search_path warning for slugify_mention_handle
create or replace function public.slugify_mention_handle(p_name text)
returns text
language plpgsql
immutable
set search_path = extensions, public
as $$
declare
  cleaned text;
  parts text[];
  first text;
  last text;
begin
  cleaned := lower(extensions.unaccent(coalesce(p_name, '')));
  cleaned := regexp_replace(cleaned, '[^a-z0-9\\s-]+', ' ', 'g');
  cleaned := regexp_replace(cleaned, '\\s+', ' ', 'g');
  cleaned := trim(cleaned);
  if cleaned is null or cleaned = '' then
    return null;
  end if;

  parts := string_to_array(cleaned, ' ');
  first := parts[1];
  last := parts[array_length(parts, 1)];
  if first is null or first = '' then
    return null;
  end if;
  if last is null or last = '' then
    last := first;
  end if;

  if last = first then
    return first;
  end if;
  return first || '.' || last;
end;
$$;

-- Forum: only author can update posts (prevent edits by others)
drop policy if exists "ForumPosts: update own" on public.forum_posts;
drop policy if exists "Leaders can moderate posts" on public.forum_posts;
drop policy if exists "Users can edit own posts" on public.forum_posts;
create policy "ForumPosts: update own" on public.forum_posts
  as permissive for update to public
  using (((select auth.uid()) = user_id) or ((select auth.uid()) = author_id))
  with check (((select auth.uid()) = user_id) or ((select auth.uid()) = author_id));

-- StudySources: consolidate policies to avoid multiple permissive policies per action
drop policy if exists "StudySources: owner manage" on public.study_sources;
drop policy if exists "StudySources: public read" on public.study_sources;
drop policy if exists "StudySources: staff manage public" on public.study_sources;
drop policy if exists "StudySources: owner read" on public.study_sources;
drop policy if exists "StudySources: owner write" on public.study_sources;
drop policy if exists "StudySources: leaders read all" on public.study_sources;
drop policy if exists "StudySources: org read published" on public.study_sources;
drop policy if exists "StudySources: staff manage org" on public.study_sources;
drop policy if exists "StudySources: write insert" on public.study_sources;
drop policy if exists "StudySources: write update" on public.study_sources;
drop policy if exists "StudySources: write delete" on public.study_sources;
drop policy if exists "StudySources owner read" on public.study_sources;
drop policy if exists "StudySources owner write" on public.study_sources;

create policy "StudySources: select" on public.study_sources
  as permissive for select to public
  using (
    (user_id = (select auth.uid()))
    or (scope = 'org' and published = true)
    or (
      scope = 'org'
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = (select auth.uid())
          and ur.role::text in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
      )
    )
  );

create policy "StudySources: insert" on public.study_sources
  as permissive for insert to public
  with check (
    (user_id = (select auth.uid()) and scope = 'user')
    or (
      scope = 'org'
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = (select auth.uid())
          and ur.role::text in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
      )
    )
  );

create policy "StudySources: update" on public.study_sources
  as permissive for update to public
  using (
    (user_id = (select auth.uid()) and scope = 'user')
    or (
      scope = 'org'
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = (select auth.uid())
          and ur.role::text in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
      )
    )
  )
  with check (
    (user_id = (select auth.uid()) and scope = 'user')
    or (
      scope = 'org'
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = (select auth.uid())
          and ur.role::text in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
      )
    )
  );

create policy "StudySources: delete" on public.study_sources
  as permissive for delete to public
  using (
    (user_id = (select auth.uid()) and scope = 'user')
    or (
      scope = 'org'
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = (select auth.uid())
          and ur.role::text in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin','lider_equipe')
      )
    )
  );

-- StudySourceQuestions: split select vs write to avoid duplicated SELECT policies
drop policy if exists "StudySourceQuestions: owner manage" on public.study_source_questions;
drop policy if exists "StudySourceQuestions: read public or own" on public.study_source_questions;

create policy "StudySourceQuestions: select" on public.study_source_questions
  as permissive for select to public
  using (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and (ss.user_id = (select auth.uid()) or (ss.scope = 'org' and ss.published = true))
    )
  );

create policy "StudySourceQuestions: insert" on public.study_source_questions
  as permissive for insert to public
  with check (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and ss.user_id = (select auth.uid())
    )
  );

create policy "StudySourceQuestions: update" on public.study_source_questions
  as permissive for update to public
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

create policy "StudySourceQuestions: delete" on public.study_source_questions
  as permissive for delete to public
  using (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and ss.user_id = (select auth.uid())
    )
  );

-- SEPBook: remove duplicate select_all policies to keep a single SELECT policy
drop policy if exists "sepbook_comments_select_all" on public.sepbook_comments;
drop policy if exists "sepbook_likes_select_all" on public.sepbook_likes;
drop policy if exists "sepbook_post_participants_select_all" on public.sepbook_post_participants;
drop policy if exists "sepbook_posts_select_all" on public.sepbook_posts;
