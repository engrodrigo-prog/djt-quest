-- User feedback messages (private, with links to evaluated items)

create table if not exists public.user_feedback_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  context_type text not null default 'general',
  context_url text,
  context_label text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz
);

create index if not exists idx_user_feedback_messages_recipient_created_at
  on public.user_feedback_messages (recipient_id, created_at desc);

create index if not exists idx_user_feedback_messages_sender_created_at
  on public.user_feedback_messages (sender_id, created_at desc);

create index if not exists idx_user_feedback_messages_recipient_unread
  on public.user_feedback_messages (recipient_id)
  where read_at is null;

alter table public.user_feedback_messages enable row level security;

drop policy if exists "UserFeedbackMessages: select own" on public.user_feedback_messages;
create policy "UserFeedbackMessages: select own"
  on public.user_feedback_messages
  for select
  to authenticated
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
    or public.is_staff((select auth.uid()))
  );

drop policy if exists "UserFeedbackMessages: leaders insert" on public.user_feedback_messages;
create policy "UserFeedbackMessages: leaders insert"
  on public.user_feedback_messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and recipient_id is not null
    and length(trim(message)) >= 3
    and (
      public.is_staff((select auth.uid()))
      or public.has_role((select auth.uid()), 'lider_equipe')
      or exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and coalesce(p.is_leader, false) = true
      )
    )
  );

drop policy if exists "UserFeedbackMessages: recipient update read" on public.user_feedback_messages;
create policy "UserFeedbackMessages: recipient update read"
  on public.user_feedback_messages
  for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

