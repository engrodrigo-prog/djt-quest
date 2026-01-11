-- XP awards ledger (e.g., leaders publishing quizzes) + breakdown support.

create table if not exists public.xp_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  amount integer not null default 0,
  quiz_id uuid null references public.challenges(id) on delete set null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  constraint xp_awards_amount_nonzero check (amount <> 0)
);

create index if not exists idx_xp_awards_user_created_at on public.xp_awards(user_id, created_at desc);
create index if not exists idx_xp_awards_kind on public.xp_awards(kind);

-- Prevent double-awarding for the same quiz publish by same user.
create unique index if not exists ux_xp_awards_quiz_publish
  on public.xp_awards(user_id, kind, quiz_id)
  where quiz_id is not null;

alter table public.xp_awards enable row level security;

drop policy if exists "xp_awards: self/staff read" on public.xp_awards;
create policy "xp_awards: self/staff read"
on public.xp_awards for select
to public
using (
  (user_id = (select auth.uid()))
  or public.is_staff((select auth.uid()))
  or public.has_role((select auth.uid()), 'admin')
);

drop policy if exists "xp_awards: staff insert" on public.xp_awards;
create policy "xp_awards: staff insert"
on public.xp_awards for insert
to public
with check (
  public.is_staff((select auth.uid()))
  or public.has_role((select auth.uid()), 'admin')
);

-- Extend points breakdown with quiz publish XP (leaders publishing quizzes).
drop function if exists public.user_points_breakdown(uuid[]);
create or replace function public.user_points_breakdown(_user_ids uuid[])
returns table(
  user_id uuid,
  quiz_xp integer,
  forum_posts integer,
  sepbook_photo_count integer,
  sepbook_comments integer,
  sepbook_likes integer,
  initiatives_xp integer,
  evaluations_completed integer,
  quiz_publish_xp integer
)
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select unnest(coalesce(_user_ids, array[]::uuid[])) as user_id
  ),
  quiz as (
    select user_id, coalesce(sum(coalesce(xp_earned,0)),0)::int as quiz_xp
    from public.user_quiz_answers
    where user_id = any(_user_ids)
    group by user_id
  ),
  forum as (
    select coalesce(author_id, user_id) as user_id, count(*)::int as forum_posts
    from public.forum_posts
    where coalesce(author_id, user_id) = any(_user_ids)
    group by 1
  ),
  sep_photos as (
    select user_id, coalesce(sum(public.count_image_attachments(attachments)),0)::int as sepbook_photo_count
    from public.sepbook_posts
    where user_id = any(_user_ids)
    group by user_id
  ),
  sep_comments as (
    select user_id, count(*)::int as sepbook_comments
    from public.sepbook_comments
    where user_id = any(_user_ids)
    group by user_id
  ),
  sep_likes as (
    select user_id, count(*)::int as likes
    from public.sepbook_likes
    where user_id = any(_user_ids)
    group by user_id
  ),
  sep_comment_likes as (
    select user_id, count(*)::int as likes
    from public.sepbook_comment_likes
    where user_id = any(_user_ids)
    group by user_id
  ),
  ev as (
    select user_id, coalesce(sum(coalesce(final_points,0)),0)::int as initiatives_xp
    from public.events
    where user_id = any(_user_ids)
    group by user_id
  ),
  evals as (
    select assigned_to as user_id,
           count(*) filter (where completed_at is not null)::int as evaluations_completed
    from public.evaluation_queue
    where assigned_to = any(_user_ids)
    group by assigned_to
  ),
  qp as (
    select user_id, coalesce(sum(amount),0)::int as quiz_publish_xp
    from public.xp_awards
    where user_id = any(_user_ids)
      and kind = 'quiz_publish'
    group by user_id
  )
  select u.user_id,
         coalesce(quiz.quiz_xp,0) as quiz_xp,
         coalesce(forum.forum_posts,0) as forum_posts,
         coalesce(sep_photos.sepbook_photo_count,0) as sepbook_photo_count,
         coalesce(sep_comments.sepbook_comments,0) as sepbook_comments,
         (coalesce(sep_likes.likes,0) + coalesce(sep_comment_likes.likes,0))::int as sepbook_likes,
         coalesce(ev.initiatives_xp,0) as initiatives_xp,
         coalesce(evals.evaluations_completed,0) as evaluations_completed,
         coalesce(qp.quiz_publish_xp,0) as quiz_publish_xp
  from u
  left join quiz on quiz.user_id = u.user_id
  left join forum on forum.user_id = u.user_id
  left join sep_photos on sep_photos.user_id = u.user_id
  left join sep_comments on sep_comments.user_id = u.user_id
  left join sep_likes on sep_likes.user_id = u.user_id
  left join sep_comment_likes on sep_comment_likes.user_id = u.user_id
  left join ev on ev.user_id = u.user_id
  left join evals on evals.user_id = u.user_id
  left join qp on qp.user_id = u.user_id;
$$;
