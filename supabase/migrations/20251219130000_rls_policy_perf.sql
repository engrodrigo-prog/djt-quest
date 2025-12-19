-- RLS performance fixes: wrap auth.* calls and consolidate permissive policies
drop policy if exists "Leaders can view evaluations" on public.action_evaluations;
drop policy if exists "Users can view evaluations for own events" on public.action_evaluations;
create policy "Leaders can view evaluations" on public.action_evaluations as permissive for select to authenticated using (((has_role(( SELECT auth.uid() AS uid), 'admin'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente'::text) OR has_role(( SELECT auth.uid() AS uid), 'lider_divisao'::text) OR has_role(( SELECT auth.uid() AS uid), 'coordenador'::text))) OR ((EXISTS ( SELECT 1
   FROM events
  WHERE ((events.id = action_evaluations.event_id) AND (events.user_id = ( SELECT auth.uid() AS uid)))))));

drop policy if exists "ContentImports: creator read" on public.content_imports;
drop policy if exists "ContentImports: curator read" on public.content_imports;
create policy "ContentImports: creator read" on public.content_imports as permissive for select to authenticated using (((created_by = (select auth.uid()))) OR (can_curate_content((select auth.uid()))));

drop policy if exists "All can view coordinations" on public.coordinations;
drop policy if exists "Coordinations are readable" on public.coordinations;
create policy "All can view coordinations" on public.coordinations as permissive for select to authenticated using (true);

drop policy if exists "Leaders can view events in their area" on public.events;
drop policy if exists "Users can view own events" on public.events;
create policy "Leaders can view events in their area" on public.events as permissive for select to authenticated using (((has_role(( SELECT auth.uid() AS uid), 'admin'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente'::text) OR has_role(( SELECT auth.uid() AS uid), 'lider_divisao'::text) OR has_role(( SELECT auth.uid() AS uid), 'coordenador'::text))) OR ((( SELECT auth.uid() AS uid) = user_id)));

drop policy if exists "Events: self read/insert" on public.events;
drop policy if exists "Events: staff read" on public.events;
create policy "Events: self read/insert" on public.events as permissive for select to public using ((((select auth.uid()) = user_id)) OR (is_staff((select auth.uid()))));

drop policy if exists "ForumPosts: create" on public.forum_posts;
drop policy if exists "ForumPosts: insert own" on public.forum_posts;
drop policy if exists "Users can create posts" on public.forum_posts;
create policy "ForumPosts: create" on public.forum_posts as permissive for insert to public with check ((((select auth.uid()) = author_id)) OR ((( SELECT auth.uid() AS uid) = user_id)) OR (((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM forum_topics
  WHERE ((forum_topics.id = forum_posts.topic_id) AND (forum_topics.is_active = true) AND (forum_topics.is_locked = false)))))));

drop policy if exists "ForumPosts: read" on public.forum_posts;
drop policy if exists "ForumPosts: select" on public.forum_posts;
drop policy if exists "Users can view posts" on public.forum_posts;
create policy "ForumPosts: read" on public.forum_posts as permissive for select to public using (true);

drop policy if exists "ForumPosts: update own" on public.forum_posts;
drop policy if exists "Leaders can moderate posts" on public.forum_posts;
drop policy if exists "Users can edit own posts" on public.forum_posts;
create policy "ForumPosts: update own" on public.forum_posts as permissive for update to public using (((( SELECT auth.uid() AS uid) = user_id)) OR ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.studio_access = true))))) OR (((author_id = ( SELECT auth.uid() AS uid)) AND (created_at > (now() - '24:00:00'::interval)))));

drop policy if exists "ForumTopics: create" on public.forum_topics;
drop policy if exists "ForumTopics: leaders insert" on public.forum_topics;
drop policy if exists "Leaders can create topics" on public.forum_topics;
create policy "ForumTopics: create" on public.forum_topics as permissive for insert to public with check ((((select auth.uid()) IS NOT NULL)) OR ((has_role(( SELECT auth.uid() AS uid), 'coordenador_djtx'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente_divisao_djtx'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente_djt'::text) OR has_role(( SELECT auth.uid() AS uid), 'admin'::text))) OR ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.studio_access = true))))));

drop policy if exists "ForumTopics: read" on public.forum_topics;
drop policy if exists "ForumTopics: select all" on public.forum_topics;
drop policy if exists "Users can view targeted topics" on public.forum_topics;
create policy "ForumTopics: read" on public.forum_topics as permissive for select to public using (true);

drop policy if exists "ForumTopics: edit by creator or leaders" on public.forum_topics;
drop policy if exists "Leaders can moderate topics" on public.forum_topics;
create policy "ForumTopics: edit by creator or leaders" on public.forum_topics as permissive for update to public using ((((created_by = ( SELECT auth.uid() AS uid)) OR has_role(( SELECT auth.uid() AS uid), 'coordenador_djtx'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente_divisao_djtx'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente_djt'::text) OR has_role(( SELECT auth.uid() AS uid), 'admin'::text))) OR ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.studio_access = true))))));

drop policy if exists "Leaders can review password resets" on public.password_reset_requests;
drop policy if exists "Users can view their password resets" on public.password_reset_requests;
create policy "Leaders can review password resets" on public.password_reset_requests as permissive for select to authenticated using (((has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'coordenador_djtx'::text))) OR (((select auth.uid()) = user_id)));

drop policy if exists "Anyone can register" on public.pending_registrations;
drop policy if exists "Pending: anyone insert" on public.pending_registrations;
create policy "Anyone can register" on public.pending_registrations as permissive for insert to public with check (true);

drop policy if exists "Leaders can view requests in their hierarchy" on public.profile_change_requests;
drop policy if exists "Users can view own change requests" on public.profile_change_requests;
create policy "Leaders can view requests in their hierarchy" on public.profile_change_requests as permissive for select to public using (((has_role(( SELECT auth.uid() AS uid), 'admin'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente_djt'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente_divisao_djtx'::text) OR has_role(( SELECT auth.uid() AS uid), 'coordenador_djtx'::text))) OR (((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = requested_by))));

drop policy if exists "Profiles: self read" on public.profiles;
drop policy if exists "Public can view profiles" on public.profiles;
create policy "Profiles: self read" on public.profiles as permissive for select to public using (true);

drop policy if exists "QuizVersions: curator read" on public.quiz_versions;
drop policy if exists "QuizVersions: owner read" on public.quiz_versions;
create policy "QuizVersions: curator read" on public.quiz_versions as permissive for select to authenticated using ((can_curate_content((select auth.uid()))) OR ((EXISTS ( SELECT 1
   FROM challenges c
  WHERE ((c.id = quiz_versions.challenge_id) AND ((c.owner_id = (select auth.uid())) OR (c.created_by = (select auth.uid()))))))));

drop policy if exists "StudySources: owner write" on public.study_sources;
drop policy if exists "StudySources: staff manage org" on public.study_sources;
create policy "StudySources: owner write" on public.study_sources as permissive for all to public using ((((user_id = ( SELECT auth.uid() AS uid)) AND (scope = 'user'::text))) OR (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND ((ur.role)::text = ANY (ARRAY['coordenador_djtx'::text, 'gerente_divisao_djtx'::text, 'gerente_djt'::text, 'admin'::text, 'lider_equipe'::text])))))))) with check ((((user_id = ( SELECT auth.uid() AS uid)) AND (scope = 'user'::text))) OR (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND ((ur.role)::text = ANY (ARRAY['coordenador_djtx'::text, 'gerente_divisao_djtx'::text, 'gerente_djt'::text, 'admin'::text, 'lider_equipe'::text]))))))));

drop policy if exists "StudySources: leaders read all" on public.study_sources;
drop policy if exists "StudySources: org read published" on public.study_sources;
drop policy if exists "StudySources: owner read" on public.study_sources;
create policy "StudySources: leaders read all" on public.study_sources as permissive for select to public using ((((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['coordenador_djtx'::app_role, 'gerente_divisao_djtx'::app_role, 'gerente_djt'::app_role, 'admin'::app_role]))))))) OR (((scope = 'org'::text) AND (published = true))) OR ((user_id = ( SELECT auth.uid() AS uid))));

drop policy if exists "All can view teams" on public.teams;
drop policy if exists "Teams are readable" on public.teams;
create policy "All can view teams" on public.teams as permissive for select to authenticated using (true);

drop policy if exists "Leaders can view all answers" on public.user_quiz_answers;
drop policy if exists "Users can view own answers" on public.user_quiz_answers;
create policy "Leaders can view all answers" on public.user_quiz_answers as permissive for select to authenticated using (((has_role(( SELECT auth.uid() AS uid), 'coordenador_djtx'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente_divisao_djtx'::text) OR has_role(( SELECT auth.uid() AS uid), 'gerente_djt'::text))) OR ((( SELECT auth.uid() AS uid) = user_id)));

drop policy if exists "AuditLog: admin read" on public.audit_log;
create policy "AuditLog: admin read" on public.audit_log as permissive for select to authenticated using (has_role((select auth.uid()), 'admin'::text));

drop policy if exists "Admins and leaders can create challenges" on public.challenges;
create policy "Admins and leaders can create challenges" on public.challenges as permissive for insert to authenticated with check ((has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'coordenador_djtx'::text) OR (has_role((select auth.uid()), 'content_curator'::text) AND ((type)::text = 'quiz'::text))));

drop policy if exists "Challenges: published or own or curator read" on public.challenges;
create policy "Challenges: published or own or curator read" on public.challenges as permissive for select to authenticated using ((((type)::text <> 'quiz'::text) OR ((quiz_workflow_status IS NULL) OR (quiz_workflow_status = 'PUBLISHED'::quiz_workflow_status)) OR ((owner_id = (select auth.uid())) OR (created_by = (select auth.uid()))) OR can_curate_content((select auth.uid()))));

drop policy if exists "ContentChanges: insert own" on public.content_change_requests;
create policy "ContentChanges: insert own" on public.content_change_requests as permissive for insert to authenticated with check ((requested_by = (select auth.uid())));

drop policy if exists "ContentChanges: staff read" on public.content_change_requests;
create policy "ContentChanges: staff read" on public.content_change_requests as permissive for select to authenticated using (is_staff((select auth.uid())));

drop policy if exists "ContentImports: creator insert" on public.content_imports;
create policy "ContentImports: creator insert" on public.content_imports as permissive for insert to authenticated with check ((created_by = (select auth.uid())));

drop policy if exists "Events: self insert" on public.events;
create policy "Events: self insert" on public.events as permissive for insert to public with check (((select auth.uid()) = user_id));

drop policy if exists "Coordinators can view pending" on public.pending_registrations;
create policy "Coordinators can view pending" on public.pending_registrations as permissive for select to public using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text)));

drop policy if exists "Coordinators can update status" on public.pending_registrations;
create policy "Coordinators can update status" on public.pending_registrations as permissive for update to public using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text)));

drop policy if exists "Profiles: staff manage" on public.profiles;
create policy "Profiles: staff manage" on public.profiles as permissive for all to public using (is_staff((select auth.uid()))) with check (is_staff((select auth.uid())));

drop policy if exists "Profiles: self update minimal" on public.profiles;
create policy "Profiles: self update minimal" on public.profiles as permissive for update to public using (((select auth.uid()) = id)) with check (((select auth.uid()) = id));

drop policy if exists "QuizCurationComments: insert" on public.quiz_curation_comments;
create policy "QuizCurationComments: insert" on public.quiz_curation_comments as permissive for insert to authenticated with check (((author_id = (select auth.uid())) AND (can_curate_content((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM challenges c
  WHERE ((c.id = quiz_curation_comments.challenge_id) AND ((c.owner_id = (select auth.uid())) OR (c.created_by = (select auth.uid())))))))));

drop policy if exists "QuizCurationComments: read" on public.quiz_curation_comments;
create policy "QuizCurationComments: read" on public.quiz_curation_comments as permissive for select to authenticated using ((can_curate_content((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM challenges c
  WHERE ((c.id = quiz_curation_comments.challenge_id) AND ((c.owner_id = (select auth.uid())) OR (c.created_by = (select auth.uid()))))))));

drop policy if exists "Studio can delete options" on public.quiz_options;
create policy "Studio can delete options" on public.quiz_options as permissive for delete to authenticated using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (COALESCE(p.is_leader, false) OR COALESCE(p.studio_access, false)))))));

drop policy if exists "Studio can insert options" on public.quiz_options;
create policy "Studio can insert options" on public.quiz_options as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM quiz_questions qq
  WHERE ((qq.id = quiz_options.question_id) AND (has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = (select auth.uid())) AND (COALESCE(p.is_leader, false) OR COALESCE(p.studio_access, false))))))))));

drop policy if exists "QuizOptions: published or own or curator read" on public.quiz_options;
create policy "QuizOptions: published or own or curator read" on public.quiz_options as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM (quiz_questions qq
     JOIN challenges c ON ((c.id = qq.challenge_id)))
  WHERE ((qq.id = quiz_options.question_id) AND (((c.type)::text <> 'quiz'::text) OR ((c.quiz_workflow_status IS NULL) OR (c.quiz_workflow_status = 'PUBLISHED'::quiz_workflow_status)) OR ((c.owner_id = (select auth.uid())) OR (c.created_by = (select auth.uid()))) OR can_curate_content((select auth.uid())))))));

drop policy if exists "Studio can update options" on public.quiz_options;
create policy "Studio can update options" on public.quiz_options as permissive for update to authenticated using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (COALESCE(p.is_leader, false) OR COALESCE(p.studio_access, false)))))));

drop policy if exists "Studio can delete questions" on public.quiz_questions;
create policy "Studio can delete questions" on public.quiz_questions as permissive for delete to authenticated using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (COALESCE(p.is_leader, false) OR COALESCE(p.studio_access, false)))))));

drop policy if exists "Studio can create questions" on public.quiz_questions;
create policy "Studio can create questions" on public.quiz_questions as permissive for insert to authenticated with check ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (COALESCE(p.is_leader, false) OR COALESCE(p.studio_access, false)))))));

drop policy if exists "QuizQuestions: published or own or curator read" on public.quiz_questions;
create policy "QuizQuestions: published or own or curator read" on public.quiz_questions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM challenges c
  WHERE ((c.id = quiz_questions.challenge_id) AND (((c.type)::text <> 'quiz'::text) OR ((c.quiz_workflow_status IS NULL) OR (c.quiz_workflow_status = 'PUBLISHED'::quiz_workflow_status)) OR ((c.owner_id = (select auth.uid())) OR (c.created_by = (select auth.uid()))) OR can_curate_content((select auth.uid())))))));

drop policy if exists "Studio can update questions" on public.quiz_questions;
create policy "Studio can update questions" on public.quiz_questions as permissive for update to authenticated using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (COALESCE(p.is_leader, false) OR COALESCE(p.studio_access, false)))))));

drop policy if exists "sepbook_comments_delete_own_or_staff" on public.sepbook_comments;
create policy "sepbook_comments_delete_own_or_staff" on public.sepbook_comments as permissive for delete to authenticated using (((user_id = (select auth.uid())) OR is_staff((select auth.uid()))));

drop policy if exists "sepbook_comments_insert_own" on public.sepbook_comments;
create policy "sepbook_comments_insert_own" on public.sepbook_comments as permissive for insert to authenticated with check ((user_id = (select auth.uid())));

drop policy if exists "sepbook_last_seen_upsert_own" on public.sepbook_last_seen;
create policy "sepbook_last_seen_upsert_own" on public.sepbook_last_seen as permissive for insert to authenticated with check ((user_id = (select auth.uid())));

drop policy if exists "sepbook_last_seen_update_own" on public.sepbook_last_seen;
create policy "sepbook_last_seen_update_own" on public.sepbook_last_seen as permissive for update to authenticated using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));

drop policy if exists "sepbook_likes_delete_own" on public.sepbook_likes;
create policy "sepbook_likes_delete_own" on public.sepbook_likes as permissive for delete to authenticated using ((user_id = (select auth.uid())));

drop policy if exists "sepbook_likes_insert_own" on public.sepbook_likes;
create policy "sepbook_likes_insert_own" on public.sepbook_likes as permissive for insert to authenticated with check ((user_id = (select auth.uid())));

drop policy if exists "sepbook_mentions_update_read_own" on public.sepbook_mentions;
create policy "sepbook_mentions_update_read_own" on public.sepbook_mentions as permissive for update to authenticated using ((mentioned_user_id = (select auth.uid()))) with check ((mentioned_user_id = (select auth.uid())));

drop policy if exists "sepbook_post_participants_insert_if_owner" on public.sepbook_post_participants;
create policy "sepbook_post_participants_insert_if_owner" on public.sepbook_post_participants as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM sepbook_posts p
  WHERE ((p.id = sepbook_post_participants.post_id) AND (p.user_id = (select auth.uid()))))));

drop policy if exists "sepbook_posts_delete_own_or_staff" on public.sepbook_posts;
create policy "sepbook_posts_delete_own_or_staff" on public.sepbook_posts as permissive for delete to authenticated using (((user_id = (select auth.uid())) OR is_staff((select auth.uid()))));

drop policy if exists "sepbook_posts_insert_own" on public.sepbook_posts;
create policy "sepbook_posts_insert_own" on public.sepbook_posts as permissive for insert to authenticated with check ((user_id = (select auth.uid())));

drop policy if exists "sepbook_posts_update_own_or_staff" on public.sepbook_posts;
create policy "sepbook_posts_update_own_or_staff" on public.sepbook_posts as permissive for update to authenticated using (((user_id = (select auth.uid())) OR is_staff((select auth.uid())))) with check (((user_id = (select auth.uid())) OR is_staff((select auth.uid()))));

-- Additional consolidations for ALL overlaps and public/authenticated duplicates
drop policy if exists "Events: self read/insert" on public.events;
drop policy if exists "Events: staff read" on public.events;
drop policy if exists "Leaders can view events in their area" on public.events;
drop policy if exists "Users can view own events" on public.events;
create policy "Events: self read/insert" on public.events as permissive for select to public using ((((select auth.uid()) = user_id) OR is_staff((select auth.uid())) OR has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente'::text) OR has_role((select auth.uid()), 'lider_divisao'::text) OR has_role((select auth.uid()), 'coordenador'::text)));

drop policy if exists "Events: self insert" on public.events;
drop policy if exists "Users can create events" on public.events;
create policy "Events: self insert" on public.events as permissive for insert to public with check (((select auth.uid()) = user_id));

drop policy if exists "ForumCompendia: leaders upsert" on public.forum_compendia;
drop policy if exists "ForumCompendia: select" on public.forum_compendia;
create policy "ForumCompendia: select" on public.forum_compendia as permissive for select to public using (true);
create policy "ForumCompendia: leaders insert" on public.forum_compendia as permissive for insert to public with check ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'admin'::text)));
create policy "ForumCompendia: leaders update" on public.forum_compendia as permissive for update to public using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'admin'::text))) with check ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'admin'::text)));
create policy "ForumCompendia: leaders delete" on public.forum_compendia as permissive for delete to public using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'admin'::text)));

drop policy if exists "Pending: staff read/update" on public.pending_registrations;
drop policy if exists "Coordinators can view pending" on public.pending_registrations;
drop policy if exists "Coordinators can update status" on public.pending_registrations;
drop policy if exists "Anyone can register" on public.pending_registrations;
drop policy if exists "Pending: anyone insert" on public.pending_registrations;
create policy "Anyone can register" on public.pending_registrations as permissive for insert to public with check (true);
create policy "Coordinators can view pending" on public.pending_registrations as permissive for select to public using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR is_staff((select auth.uid()))));
create policy "Coordinators can update status" on public.pending_registrations as permissive for update to public using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR is_staff((select auth.uid())))) with check ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR is_staff((select auth.uid()))));
create policy "Pending: staff delete" on public.pending_registrations as permissive for delete to public using (is_staff((select auth.uid())));

drop policy if exists "Profiles: self update minimal" on public.profiles;
drop policy if exists "Profiles: staff manage" on public.profiles;
create policy "Profiles: self update minimal" on public.profiles as permissive for update to public using ((((select auth.uid()) = id) OR is_staff((select auth.uid())))) with check ((((select auth.uid()) = id) OR is_staff((select auth.uid()))));
create policy "Profiles: staff insert" on public.profiles as permissive for insert to public with check (is_staff((select auth.uid())));
create policy "Profiles: staff delete" on public.profiles as permissive for delete to public using (is_staff((select auth.uid())));

drop policy if exists "StudySources: owner write" on public.study_sources;
drop policy if exists "StudySources: leaders read all" on public.study_sources;
drop policy if exists "StudySources: write insert" on public.study_sources;
drop policy if exists "StudySources: write update" on public.study_sources;
drop policy if exists "StudySources: write delete" on public.study_sources;
create policy "StudySources: leaders read all" on public.study_sources as permissive for select to public using ((((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = (select auth.uid())) AND (ur.role = ANY (ARRAY['coordenador_djtx'::app_role, 'gerente_divisao_djtx'::app_role, 'gerente_djt'::app_role, 'admin'::app_role])))))) OR (((scope = 'org'::text) AND (published = true))) OR (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = (select auth.uid())) AND ((ur.role)::text = ANY (ARRAY['coordenador_djtx'::text, 'gerente_divisao_djtx'::text, 'gerente_djt'::text, 'admin'::text, 'lider_equipe'::text])))))))));
create policy "StudySources: write insert" on public.study_sources as permissive for insert to public with check ((((user_id = (select auth.uid())) AND (scope = 'user'::text)) OR (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = (select auth.uid())) AND ((ur.role)::text = ANY (ARRAY['coordenador_djtx'::text, 'gerente_divisao_djtx'::text, 'gerente_djt'::text, 'admin'::text, 'lider_equipe'::text])))))))));
create policy "StudySources: write update" on public.study_sources as permissive for update to public using ((((user_id = (select auth.uid())) AND (scope = 'user'::text)) OR (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = (select auth.uid())) AND ((ur.role)::text = ANY (ARRAY['coordenador_djtx'::text, 'gerente_divisao_djtx'::text, 'gerente_djt'::text, 'admin'::text, 'lider_equipe'::text]))))))))) with check ((((user_id = (select auth.uid())) AND (scope = 'user'::text)) OR (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = (select auth.uid())) AND ((ur.role)::text = ANY (ARRAY['coordenador_djtx'::text, 'gerente_divisao_djtx'::text, 'gerente_djt'::text, 'admin'::text, 'lider_equipe'::text])))))))));
create policy "StudySources: write delete" on public.study_sources as permissive for delete to public using ((((user_id = (select auth.uid())) AND (scope = 'user'::text)) OR (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = (select auth.uid())) AND ((ur.role)::text = ANY (ARRAY['coordenador_djtx'::text, 'gerente_divisao_djtx'::text, 'gerente_djt'::text, 'admin'::text, 'lider_equipe'::text])))))))));

drop policy if exists "SystemSettings: leaders upsert" on public.system_settings;
drop policy if exists "SystemSettings: read" on public.system_settings;
create policy "SystemSettings: read" on public.system_settings as permissive for select to public using (true);
create policy "SystemSettings: leaders insert" on public.system_settings as permissive for insert to public with check ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'admin'::text)));
create policy "SystemSettings: leaders update" on public.system_settings as permissive for update to public using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'admin'::text))) with check ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'admin'::text)));
create policy "SystemSettings: leaders delete" on public.system_settings as permissive for delete to public using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'admin'::text)));

drop policy if exists "Admins and gerentes can manage campaigns" on public.campaigns;
drop policy if exists "All can view active campaigns" on public.campaigns;
create policy "All can view active campaigns" on public.campaigns as permissive for select to authenticated using (((is_active = true) OR has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente'::text)));
create policy "Campaigns: admin insert" on public.campaigns as permissive for insert to authenticated with check ((has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente'::text)));
create policy "Campaigns: admin update" on public.campaigns as permissive for update to authenticated using ((has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente'::text))) with check ((has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente'::text)));
create policy "Campaigns: admin delete" on public.campaigns as permissive for delete to authenticated using ((has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente'::text)));

drop policy if exists "System can manage evaluation queue" on public.evaluation_queue;
drop policy if exists "Leaders can view evaluation queue" on public.evaluation_queue;
create policy "Leaders can view evaluation queue" on public.evaluation_queue as permissive for select to authenticated using ((has_role((select auth.uid()), 'coordenador_djtx'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'gerente_djt'::text)));
create policy "EvaluationQueue: system insert" on public.evaluation_queue as permissive for insert to authenticated with check (has_role((select auth.uid()), 'gerente_djt'::text));
create policy "EvaluationQueue: system update" on public.evaluation_queue as permissive for update to authenticated using (has_role((select auth.uid()), 'gerente_djt'::text)) with check (has_role((select auth.uid()), 'gerente_djt'::text));
create policy "EvaluationQueue: system delete" on public.evaluation_queue as permissive for delete to authenticated using (has_role((select auth.uid()), 'gerente_djt'::text));

drop policy if exists "Leaders can view all progression requests" on public.tier_progression_requests;
drop policy if exists "Users can view own progression requests" on public.tier_progression_requests;
drop policy if exists "System can manage progression requests" on public.tier_progression_requests;
create policy "TierProgressionRequests: read" on public.tier_progression_requests as permissive for select to public using (((has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'coordenador_djtx'::text) OR ((select auth.uid()) = user_id))));
create policy "TierProgressionRequests: system insert" on public.tier_progression_requests as permissive for insert to authenticated with check ((has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'coordenador_djtx'::text)));
create policy "TierProgressionRequests: system update" on public.tier_progression_requests as permissive for update to authenticated using ((has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'coordenador_djtx'::text))) with check ((has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'coordenador_djtx'::text)));
create policy "TierProgressionRequests: system delete" on public.tier_progression_requests as permissive for delete to authenticated using ((has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'coordenador_djtx'::text)));

drop policy if exists "Leaders can view all incidents" on public.safety_incidents;
drop policy if exists "Users can view own incidents" on public.safety_incidents;
create policy "SafetyIncidents: read" on public.safety_incidents as permissive for select to public using (((has_role((select auth.uid()), 'gerente_djt'::text) OR has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR has_role((select auth.uid()), 'coordenador_djtx'::text) OR ((select auth.uid()) = user_id))));

drop policy if exists "Managers can create global team events" on public.team_events;
drop policy if exists "Team leaders can create team events" on public.team_events;
create policy "TeamEvents: create" on public.team_events as permissive for insert to public with check (((has_role((select auth.uid()), 'gerente_djt'::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.is_leader = true) AND (profiles.team_id = team_events.team_id)))))));

drop policy if exists "Admins can manage all roles" on public.user_roles;
drop policy if exists "UserRoles: admin manage" on public.user_roles;
create policy "UserRoles: admin manage" on public.user_roles as permissive for all to public using (((has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente_djt'::text)))) with check (((has_role((select auth.uid()), 'admin'::text) OR has_role((select auth.uid()), 'gerente_djt'::text))));
