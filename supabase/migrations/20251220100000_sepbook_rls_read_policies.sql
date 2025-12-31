-- SEPBook: allow authenticated users to read feed data when service role is not used.
-- This prevents RLS read violations for posts/comments/likes.

alter table if exists public.sepbook_posts enable row level security;
alter table if exists public.sepbook_comments enable row level security;
alter table if exists public.sepbook_likes enable row level security;
alter table if exists public.sepbook_post_participants enable row level security;

do $$
begin
  -- Posts: any authenticated user can read feed
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_posts' and policyname='sepbook_posts_select_authenticated') then
    create policy "sepbook_posts_select_authenticated" on public.sepbook_posts
      for select to authenticated
      using (true);
  end if;

  -- Comments: authenticated users can read comments
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_comments' and policyname='sepbook_comments_select_authenticated') then
    create policy "sepbook_comments_select_authenticated" on public.sepbook_comments
      for select to authenticated
      using (true);
  end if;

  -- Likes: authenticated users can read likes (for own state)
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_likes' and policyname='sepbook_likes_select_authenticated') then
    create policy "sepbook_likes_select_authenticated" on public.sepbook_likes
      for select to authenticated
      using (true);
  end if;

  -- Participants: authenticated users can read participants list
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sepbook_post_participants' and policyname='sepbook_post_participants_select_authenticated') then
    create policy "sepbook_post_participants_select_authenticated" on public.sepbook_post_participants
      for select to authenticated
      using (true);
  end if;
end $$;
