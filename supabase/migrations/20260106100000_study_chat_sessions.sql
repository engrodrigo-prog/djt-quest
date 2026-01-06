-- StudyLab chat sessions/logs (for compendium + admin analytics)

create table if not exists public.study_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  mode text not null default 'study',
  source_id uuid references public.study_sources(id) on delete set null,
  title text,
  summary text,
  messages jsonb,
  attachments jsonb,
  metadata jsonb,
  compendium_source_id uuid references public.study_sources(id) on delete set null
);

create index if not exists idx_study_chat_sessions_user_id_updated_at
  on public.study_chat_sessions (user_id, updated_at desc);

alter table public.study_chat_sessions enable row level security;

drop policy if exists "StudyChatSessions: owner read" on public.study_chat_sessions;
create policy "StudyChatSessions: owner read"
  on public.study_chat_sessions for select
  to public
  using (user_id = (select auth.uid()));

drop policy if exists "StudyChatSessions: owner insert" on public.study_chat_sessions;
create policy "StudyChatSessions: owner insert"
  on public.study_chat_sessions for insert
  to public
  with check (user_id = (select auth.uid()));

drop policy if exists "StudyChatSessions: owner update" on public.study_chat_sessions;
create policy "StudyChatSessions: owner update"
  on public.study_chat_sessions for update
  to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "StudyChatSessions: owner delete" on public.study_chat_sessions;
create policy "StudyChatSessions: owner delete"
  on public.study_chat_sessions for delete
  to public
  using (user_id = (select auth.uid()));

drop policy if exists "StudyChatSessions: staff read" on public.study_chat_sessions;
create policy "StudyChatSessions: staff read"
  on public.study_chat_sessions for select
  to public
  using (is_staff((select auth.uid())));

do $$
begin
  if to_regprocedure('public.update_updated_at_column()') is not null then
    drop trigger if exists update_study_chat_sessions_updated_at on public.study_chat_sessions;
    create trigger update_study_chat_sessions_updated_at
      before update on public.study_chat_sessions
      for each row execute function public.update_updated_at_column();
  end if;
end $$;
