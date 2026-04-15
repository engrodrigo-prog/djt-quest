-- ============================================================
-- SECURITY HARDENING: RLS Policies
-- Date: 2026-04-15
-- Fixes: R-1 profiles PII leak, R-2 sepbook _select_all TO public,
--        R-3 team_performance_log / tier_demotion_log anon read,
--        R-4 forum_attachment_metadata GPS/PII + storage SELECT,
--        R-6 study_sources org-published anon read
-- ============================================================

-- ============================================================
-- 1. PROFILES: bloquear leitura por anon (PII: email, telefone, dob, matricula)
--    A politica anterior "Profiles: self read" usava TO public USING (true)
--    permitindo que qualquer um com a anon key lesse todo o diretorio.
-- ============================================================
drop policy if exists "Profiles: self read" on public.profiles;
drop policy if exists "Public can view profiles" on public.profiles;
drop policy if exists "Profiles: authenticated read" on public.profiles;

create policy "Profiles: authenticated read" on public.profiles
  as permissive for select to authenticated
  using (true);

-- ============================================================
-- 2. SEPBOOK: corrigir _select_all TO public -> TO authenticated
--    Tabelas: sepbook_xp_log, bonus_ranking_history, sepbook_mentions,
--             sepbook_last_seen, division_managers, departments
-- ============================================================

-- sepbook_xp_log
drop policy if exists "sepbook_xp_log_select_all" on public.sepbook_xp_log;
create policy "sepbook_xp_log_select_all" on public.sepbook_xp_log
  as permissive for select to authenticated
  using (true);

-- bonus_ranking_history
drop policy if exists "bonus_ranking_history_select_all" on public.bonus_ranking_history;
create policy "bonus_ranking_history_select_all" on public.bonus_ranking_history
  as permissive for select to authenticated
  using (true);

-- sepbook_mentions: restringir ao proprio usuario mencionado
drop policy if exists "sepbook_mentions_select_all" on public.sepbook_mentions;
create policy "sepbook_mentions: own read" on public.sepbook_mentions
  as permissive for select to authenticated
  using ((select auth.uid()) = mentioned_user_id);

-- sepbook_last_seen: restringir ao proprio usuario
drop policy if exists "sepbook_last_seen_select_all" on public.sepbook_last_seen;
create policy "sepbook_last_seen: own read" on public.sepbook_last_seen
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

-- division_managers: ok para todos os autenticados (necessario para UI de org)
drop policy if exists "division_managers_select_all" on public.division_managers;
create policy "division_managers_select_all" on public.division_managers
  as permissive for select to authenticated
  using (true);

-- departments: ok para todos os autenticados (necessario para UI de org)
drop policy if exists "departments_select_all" on public.departments;
create policy "departments_select_all" on public.departments
  as permissive for select to authenticated
  using (true);

-- ============================================================
-- 3. TEAM_PERFORMANCE_LOG e TIER_DEMOTION_LOG
--    Eram acessiveis por anon (sem TO clause = TO public)
-- ============================================================
drop policy if exists "All can view team performance log" on public.team_performance_log;
create policy "Authenticated can view team performance log" on public.team_performance_log
  as permissive for select to authenticated
  using (true);

drop policy if exists "All can view demotion log" on public.tier_demotion_log;
create policy "Authenticated can view demotion log" on public.tier_demotion_log
  as permissive for select to authenticated
  using (true);

-- ============================================================
-- 4. FORUM ATTACHMENT METADATA: bloquear leitura de GPS/PII por anon
--    A politica anterior "Anyone can view attachment metadata" usava
--    TO public USING (true) expondo gps_latitude, gps_longitude, etc.
-- ============================================================
drop policy if exists "Anyone can view attachment metadata" on public.forum_attachment_metadata;
drop policy if exists "Authenticated can view attachment metadata" on public.forum_attachment_metadata;

create policy "Authenticated can view attachment metadata" on public.forum_attachment_metadata
  as permissive for select to authenticated
  using (true);

-- ============================================================
-- 5. FORUM-ATTACHMENTS STORAGE: bloquear SELECT por anon
--    Impede que o anon liste/leia objetos via PostgREST/API.
--    NOTA: o bucket permanece public=true para URLs publicas existentes.
--    Para protecao completa, migrar frontend para signed URLs e
--    setar public=false em uma PR separada.
-- ============================================================
drop policy if exists "Public can view forum attachments" on storage.objects;
drop policy if exists "Authenticated can view forum attachments" on storage.objects;

create policy "Authenticated can view forum attachments" on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'forum-attachments');

-- ============================================================
-- 6. STUDY SOURCES: corrigir TO public -> TO authenticated
--    A politica "StudySources: select" em 20260106123000 usava TO public,
--    permitindo que anon lesse conteudo org/published.
-- ============================================================
drop policy if exists "StudySources: select" on public.study_sources;

create policy "StudySources: select" on public.study_sources
  as permissive for select to authenticated
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

-- Corrigir demais politicas de write que usavam TO public
drop policy if exists "StudySources: insert" on public.study_sources;
create policy "StudySources: insert" on public.study_sources
  as permissive for insert to authenticated
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

drop policy if exists "StudySources: update" on public.study_sources;
create policy "StudySources: update" on public.study_sources
  as permissive for update to authenticated
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

drop policy if exists "StudySources: delete" on public.study_sources;
create policy "StudySources: delete" on public.study_sources
  as permissive for delete to authenticated
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

-- Corrigir StudySourceQuestions: TO public -> TO authenticated
drop policy if exists "StudySourceQuestions: select" on public.study_source_questions;
create policy "StudySourceQuestions: select" on public.study_source_questions
  as permissive for select to authenticated
  using (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and (ss.user_id = (select auth.uid()) or (ss.scope = 'org' and ss.published = true))
    )
  );

drop policy if exists "StudySourceQuestions: insert" on public.study_source_questions;
create policy "StudySourceQuestions: insert" on public.study_source_questions
  as permissive for insert to authenticated
  with check (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and ss.user_id = (select auth.uid())
    )
  );

drop policy if exists "StudySourceQuestions: update" on public.study_source_questions;
create policy "StudySourceQuestions: update" on public.study_source_questions
  as permissive for update to authenticated
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

drop policy if exists "StudySourceQuestions: delete" on public.study_source_questions;
create policy "StudySourceQuestions: delete" on public.study_source_questions
  as permissive for delete to authenticated
  using (
    exists (
      select 1
      from public.study_sources ss
      where ss.id = source_id
        and ss.user_id = (select auth.uid())
    )
  );

-- ForumPosts: corrigir TO public -> TO authenticated
drop policy if exists "ForumPosts: update own" on public.forum_posts;
create policy "ForumPosts: update own" on public.forum_posts
  as permissive for update to authenticated
  using (((select auth.uid()) = user_id) or ((select auth.uid()) = author_id))
  with check (((select auth.uid()) = user_id) or ((select auth.uid()) = author_id));
