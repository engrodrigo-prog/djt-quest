alter table if exists public.forum_mentions enable row level security;

drop policy if exists "ForumMentions: insert for own post" on public.forum_mentions;
create policy "ForumMentions: insert for own post"
  on public.forum_mentions
  for insert
  to authenticated
  with check (
    mentioned_by = (select auth.uid())
    and mentioned_user_id is not null
    and mentioned_user_id <> (select auth.uid())
    and exists (
      select 1
      from public.forum_posts p
      where p.id = post_id
        and ((p.user_id = (select auth.uid())) or (p.author_id = (select auth.uid())))
    )
  );

drop policy if exists "ForumMentions: author delete" on public.forum_mentions;
create policy "ForumMentions: author delete"
  on public.forum_mentions
  for delete
  to authenticated
  using (
    mentioned_by = (select auth.uid())
    and exists (
      select 1
      from public.forum_posts p
      where p.id = post_id
        and ((p.user_id = (select auth.uid())) or (p.author_id = (select auth.uid())))
    )
  );

drop policy if exists "ForumMentions: mentioned mark read" on public.forum_mentions;
create policy "ForumMentions: mentioned mark read"
  on public.forum_mentions
  for update
  to authenticated
  using (mentioned_user_id = (select auth.uid()))
  with check (mentioned_user_id = (select auth.uid()));
