-- SEPBook comments: replies, likes, and edits

alter table if exists public.sepbook_comments
  add column if not exists parent_id uuid references public.sepbook_comments(id) on delete cascade;

alter table if exists public.sepbook_comments
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_sepbook_comments_parent_id
  on public.sepbook_comments(parent_id);

-- Allow comment owners to edit their own comments

drop policy if exists "sepbook_comments_update_own" on public.sepbook_comments;
create policy "sepbook_comments_update_own" on public.sepbook_comments
  as permissive for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Comment likes

create table if not exists public.sepbook_comment_likes (
  comment_id uuid not null references public.sepbook_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists idx_sepbook_comment_likes_user_id
  on public.sepbook_comment_likes(user_id);

create index if not exists idx_sepbook_comment_likes_comment_id
  on public.sepbook_comment_likes(comment_id);

alter table public.sepbook_comment_likes enable row level security;

drop policy if exists "sepbook_comment_likes_select_all" on public.sepbook_comment_likes;
create policy "sepbook_comment_likes_select_all" on public.sepbook_comment_likes
  as permissive for select to authenticated
  using (true);

drop policy if exists "sepbook_comment_likes_insert_own" on public.sepbook_comment_likes;
create policy "sepbook_comment_likes_insert_own" on public.sepbook_comment_likes
  as permissive for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "sepbook_comment_likes_delete_own" on public.sepbook_comment_likes;
create policy "sepbook_comment_likes_delete_own" on public.sepbook_comment_likes
  as permissive for delete to authenticated
  using (user_id = (select auth.uid()));

-- Allow forum likes to be removed by the same user (unlike)
drop policy if exists "forum_likes_delete_own" on public.forum_likes;
create policy "forum_likes_delete_own" on public.forum_likes
  as permissive for delete to authenticated
  using (user_id = (select auth.uid()));

do $$
begin
  if to_regprocedure('public.update_updated_at_column()') is not null then
    drop trigger if exists update_sepbook_comments_updated_at on public.sepbook_comments;
    create trigger update_sepbook_comments_updated_at
      before update on public.sepbook_comments
      for each row execute function public.update_updated_at_column();
  end if;
end $$;

-- Ensure virtual guest team exists
insert into public.teams (id, name)
values ('CONVIDADOS', 'Convidados (externo)')
on conflict (id) do nothing;
