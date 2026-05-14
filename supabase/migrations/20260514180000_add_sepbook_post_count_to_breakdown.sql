-- Add sepbook_post_count (total posts) to user_points_breakdown.
-- Previous versions only exposed sepbook_photo_count (photo attachments).
-- Needed for correct 30 XP base-per-post display in Rankings breakdown dialog.

drop function if exists public.user_points_breakdown(uuid[]);
create or replace function public.user_points_breakdown(_user_ids uuid[])
returns table(
  user_id uuid,
  quiz_xp integer,
  forum_posts integer,
  sepbook_post_count integer,
  sepbook_photo_count integer,
  sepbook_comments integer,
  sepbook_likes integer,
  initiatives_xp integer,
  evaluations_completed integer,
  quiz_publish_xp integer,
  access_sessions integer,
  access_xp numeric
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
  sep_posts as (
    select user_id, count(*)::int as sepbook_post_count
    from public.sepbook_posts
    where user_id = any(_user_ids)
    group by user_id
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
  ),
  acc as (
    select user_id,
           count(*)::int as access_sessions,
           coalesce(sum(amount),0)::numeric as access_xp
    from public.xp_awards
    where user_id = any(_user_ids)
      and kind = 'access_daily'
    group by user_id
  )
  select u.user_id,
         coalesce(quiz.quiz_xp,0) as quiz_xp,
         coalesce(forum.forum_posts,0) as forum_posts,
         coalesce(sep_posts.sepbook_post_count,0) as sepbook_post_count,
         coalesce(sep_photos.sepbook_photo_count,0) as sepbook_photo_count,
         coalesce(sep_comments.sepbook_comments,0) as sepbook_comments,
         (coalesce(sep_likes.likes,0) + coalesce(sep_comment_likes.likes,0))::int as sepbook_likes,
         coalesce(ev.initiatives_xp,0) as initiatives_xp,
         coalesce(evals.evaluations_completed,0) as evaluations_completed,
         coalesce(qp.quiz_publish_xp,0) as quiz_publish_xp,
         coalesce(acc.access_sessions,0) as access_sessions,
         coalesce(acc.access_xp,0)::numeric as access_xp
  from u
  left join quiz on quiz.user_id = u.user_id
  left join forum on forum.user_id = u.user_id
  left join sep_posts on sep_posts.user_id = u.user_id
  left join sep_photos on sep_photos.user_id = u.user_id
  left join sep_comments on sep_comments.user_id = u.user_id
  left join sep_likes on sep_likes.user_id = u.user_id
  left join sep_comment_likes on sep_comment_likes.user_id = u.user_id
  left join ev on ev.user_id = u.user_id
  left join evals on evals.user_id = u.user_id
  left join qp on qp.user_id = u.user_id
  left join acc on acc.user_id = u.user_id;
$$;
