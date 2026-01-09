-- SEPBook: mentions in comments (keep post mentions separate to preserve existing behavior).

create table if not exists public.sepbook_comment_mentions (
  comment_id uuid not null references public.sepbook_comments(id) on delete cascade,
  post_id uuid not null references public.sepbook_posts(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (comment_id, mentioned_user_id)
);

create index if not exists idx_sepbook_comment_mentions_user
  on public.sepbook_comment_mentions (mentioned_user_id, is_read, created_at desc);

alter table public.sepbook_comment_mentions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sepbook_comment_mentions' and policyname='sepbook_comment_mentions_select_own'
  ) then
    create policy "sepbook_comment_mentions_select_own" on public.sepbook_comment_mentions
      for select to authenticated
      using (mentioned_user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sepbook_comment_mentions' and policyname='sepbook_comment_mentions_update_read_own'
  ) then
    create policy "sepbook_comment_mentions_update_read_own" on public.sepbook_comment_mentions
      for update to authenticated
      using (mentioned_user_id = auth.uid())
      with check (mentioned_user_id = auth.uid());
  end if;
end $$;

