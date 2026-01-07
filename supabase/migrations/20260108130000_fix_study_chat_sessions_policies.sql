-- StudyLab chat sessions: consolidate read policies and restrict to authenticated

alter table public.study_chat_sessions enable row level security;

-- Consolidate read policies (avoid multiple permissive policies)
drop policy if exists "StudyChatSessions: owner read" on public.study_chat_sessions;
drop policy if exists "StudyChatSessions: staff read" on public.study_chat_sessions;
drop policy if exists "StudyChatSessions: read own or staff" on public.study_chat_sessions;
create policy "StudyChatSessions: read own or staff"
  on public.study_chat_sessions
  as permissive for select
  to authenticated
  using ((user_id = (select auth.uid())) or is_staff((select auth.uid())));

-- Tighten write policies to authenticated

drop policy if exists "StudyChatSessions: owner insert" on public.study_chat_sessions;
create policy "StudyChatSessions: owner insert"
  on public.study_chat_sessions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "StudyChatSessions: owner update" on public.study_chat_sessions;
create policy "StudyChatSessions: owner update"
  on public.study_chat_sessions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "StudyChatSessions: owner delete" on public.study_chat_sessions;
create policy "StudyChatSessions: owner delete"
  on public.study_chat_sessions for delete
  to authenticated
  using (user_id = (select auth.uid()));
