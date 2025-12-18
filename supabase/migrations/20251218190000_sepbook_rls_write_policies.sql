-- SEPBook: allow authenticated users to write their own content (posts/likes/comments)
-- This fixes "RLS violation" when server endpoints run without service role.

-- Ensure RLS is enabled (idempotent)
alter table if exists public.sepbook_posts enable row level security;
alter table if exists public.sepbook_comments enable row level security;
alter table if exists public.sepbook_likes enable row level security;
alter table if exists public.sepbook_mentions enable row level security;
alter table if exists public.sepbook_last_seen enable row level security;
alter table if exists public.sepbook_post_participants enable row level security;

do $$
begin
  -- Posts: author can insert/update/delete; staff can moderate
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_posts' and policyname='sepbook_posts_insert_own') then
    create policy "sepbook_posts_insert_own" on public.sepbook_posts
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_posts' and policyname='sepbook_posts_update_own_or_staff') then
    create policy "sepbook_posts_update_own_or_staff" on public.sepbook_posts
      for update to authenticated
      using (user_id = auth.uid() or public.is_staff(auth.uid()))
      with check (user_id = auth.uid() or public.is_staff(auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_posts' and policyname='sepbook_posts_delete_own_or_staff') then
    create policy "sepbook_posts_delete_own_or_staff" on public.sepbook_posts
      for delete to authenticated
      using (user_id = auth.uid() or public.is_staff(auth.uid()));
  end if;

  -- Comments: author can insert/delete; staff can delete
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_comments' and policyname='sepbook_comments_insert_own') then
    create policy "sepbook_comments_insert_own" on public.sepbook_comments
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_comments' and policyname='sepbook_comments_delete_own_or_staff') then
    create policy "sepbook_comments_delete_own_or_staff" on public.sepbook_comments
      for delete to authenticated
      using (user_id = auth.uid() or public.is_staff(auth.uid()));
  end if;

  -- Likes: user can like/unlike
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_likes' and policyname='sepbook_likes_insert_own') then
    create policy "sepbook_likes_insert_own" on public.sepbook_likes
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_likes' and policyname='sepbook_likes_delete_own') then
    create policy "sepbook_likes_delete_own" on public.sepbook_likes
      for delete to authenticated
      using (user_id = auth.uid());
  end if;

  -- Mentions: mentioned user can mark as read
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_mentions' and policyname='sepbook_mentions_update_read_own') then
    create policy "sepbook_mentions_update_read_own" on public.sepbook_mentions
      for update to authenticated
      using (mentioned_user_id = auth.uid())
      with check (mentioned_user_id = auth.uid());
  end if;

  -- Last seen: user upserts their own
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_last_seen' and policyname='sepbook_last_seen_upsert_own') then
    create policy "sepbook_last_seen_upsert_own" on public.sepbook_last_seen
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_last_seen' and policyname='sepbook_last_seen_update_own') then
    create policy "sepbook_last_seen_update_own" on public.sepbook_last_seen
      for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  -- Participants: post author can add participants rows for their post
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_post_participants' and policyname='sepbook_post_participants_insert_if_owner') then
    create policy "sepbook_post_participants_insert_if_owner" on public.sepbook_post_participants
      for insert to authenticated
      with check (
        exists (
          select 1
          from public.sepbook_posts p
          where p.id = post_id and p.user_id = auth.uid()
        )
      );
  end if;
end $$;
