-- Points breakdown helpers (from historical tables) + weighted adherence for leaders.
--
-- Motivation:
-- - Fix leader rankings not counting non-quiz/eval XP sources (SEPBook, forum, initiatives).
-- - Provide a single RPC to compute per-user point breakdown without client-side pagination limits.
-- - Enable "include leaders" team stats with partial weighting via a multiplier.

create or replace function public.count_image_attachments(_attachments jsonb)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  out_count integer := 0;
begin
  if _attachments is null then
    return 0;
  end if;
  if jsonb_typeof(_attachments) <> 'array' then
    return 0;
  end if;

  select coalesce(sum(
    case
      when jsonb_typeof(v) = 'string' then
        case
          when lower(trim(both '"' from v::text)) ~ '\\.(png|jpe?g|webp|gif|bmp|tif|tiff|heic|heif|avif)(\\?|#|$)' then 1
          else 0
        end
      when jsonb_typeof(v) = 'object' then
        case
          when lower(coalesce(v->>'url', v->>'publicUrl', v->>'href', v->>'src', '')) ~ '\\.(png|jpe?g|webp|gif|bmp|tif|tiff|heic|heif|avif)(\\?|#|$)' then 1
          else 0
        end
      else 0
    end
  ), 0)::int
  into out_count
  from jsonb_array_elements(_attachments) as v;

  return coalesce(out_count, 0);
end;
$$;

create or replace function public.user_points_breakdown(_user_ids uuid[])
returns table(
  user_id uuid,
  quiz_xp integer,
  forum_posts integer,
  sepbook_photo_count integer,
  sepbook_comments integer,
  sepbook_likes integer,
  initiatives_xp integer,
  evaluations_completed integer
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
  )
  select u.user_id,
         coalesce(quiz.quiz_xp,0) as quiz_xp,
         coalesce(forum.forum_posts,0) as forum_posts,
         coalesce(sep_photos.sepbook_photo_count,0) as sepbook_photo_count,
         coalesce(sep_comments.sepbook_comments,0) as sepbook_comments,
         (coalesce(sep_likes.likes,0) + coalesce(sep_comment_likes.likes,0))::int as sepbook_likes,
         coalesce(ev.initiatives_xp,0) as initiatives_xp,
         coalesce(evals.evaluations_completed,0) as evaluations_completed
  from u
  left join quiz on quiz.user_id = u.user_id
  left join forum on forum.user_id = u.user_id
  left join sep_photos on sep_photos.user_id = u.user_id
  left join sep_comments on sep_comments.user_id = u.user_id
  left join sep_likes on sep_likes.user_id = u.user_id
  left join sep_comment_likes on sep_comment_likes.user_id = u.user_id
  left join ev on ev.user_id = u.user_id
  left join evals on evals.user_id = u.user_id;
$$;

-- Weighted (optional) adherence helpers for team/coord/div scopes.
-- leader_multiplier = 0 => exclude leaders; 0.5 => leader counts as "half a member" and earns half XP for achieved.

create or replace function public.xp_possible_for_team_v2(_start timestamptz, _end timestamptz, _team_id text, _leader_multiplier numeric)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _coord text;
  _div text;
  _members numeric;
  _sum int := 0;
  _mult numeric := greatest(coalesce(_leader_multiplier, 0), 0);
begin
  if upper(coalesce(_team_id,'')) = 'CONVIDADOS' then
    return 0;
  end if;

  select t.coord_id, coalesce(c.division_id, public.derive_division_from_team_id(_team_id))
    into _coord, _div
  from public.teams t
  left join public.coordinations c on c.id = t.coord_id
  where t.id = _team_id;

  select
    (count(*) filter (where coalesce(p.is_leader,false)=false))::numeric
    + (count(*) filter (where coalesce(p.is_leader,false)=true))::numeric * _mult
    into _members
  from public.profiles p
  where p.team_id = _team_id
    and upper(coalesce(p.team_id,'')) <> 'CONVIDADOS';

  if _members is null or _members <= 0 then
    return 0;
  end if;

  select coalesce(sum(c.xp_reward),0)::int into _sum
  from public.challenges c
  where coalesce(lower(c.status),'active') in ('active','scheduled')
    and (c.due_date is null or (c.due_date between _start and _end))
    and (
      (c.target_team_ids is null and c.target_coord_ids is null and c.target_div_ids is null)
      or (_team_id is not null and c.target_team_ids is not null and _team_id = any(c.target_team_ids))
      or (_coord is not null and c.target_coord_ids is not null and _coord = any(c.target_coord_ids))
      or (_div   is not null and c.target_div_ids  is not null and _div   = any(c.target_div_ids))
    );

  return floor((_sum::numeric) * _members)::int;
end;
$$;

create or replace function public.xp_achieved_for_team_v2(_start timestamptz, _end timestamptz, _team_id text, _leader_multiplier numeric)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      coalesce(sum(e.final_points) filter (where coalesce(p.is_leader,false)=false),0)::numeric
      + coalesce(sum(e.final_points) filter (where coalesce(p.is_leader,false)=true),0)::numeric * greatest(coalesce(_leader_multiplier,0),0)
    )::int
  from public.events e
  join public.profiles p on p.id = e.user_id
  where e.created_at between _start and _end
    and p.team_id = _team_id
    and upper(coalesce(_team_id,'')) <> 'CONVIDADOS'
    and upper(coalesce(p.team_id,'')) <> 'CONVIDADOS';
$$;

create or replace function public.team_adherence_window_v2(_start timestamptz, _end timestamptz, _leader_multiplier numeric)
returns table(team_id text, member_count integer, possible integer, achieved integer, adherence_pct integer)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select id from public.teams where upper(id) <> 'CONVIDADOS'
  ),
  eff as (
    select
      p.team_id as id,
      floor(
        (count(*) filter (where coalesce(p.is_leader,false)=false))::numeric
        + (count(*) filter (where coalesce(p.is_leader,false)=true))::numeric * greatest(coalesce(_leader_multiplier,0),0)
      )::int as members
    from public.profiles p
    where p.team_id is not null and upper(p.team_id) <> 'CONVIDADOS'
    group by p.team_id
  ),
  poss as (
    select id as team_id, public.xp_possible_for_team_v2(_start, _end, id, _leader_multiplier) as possible from t
  ),
  ach as (
    select id as team_id, public.xp_achieved_for_team_v2(_start, _end, id, _leader_multiplier) as achieved from t
  )
  select t.id,
         coalesce(eff.members,0) as member_count,
         coalesce(poss.possible,0) as possible,
         coalesce(ach.achieved,0) as achieved,
         case when coalesce(poss.possible,0) > 0 then round(100.0*coalesce(ach.achieved,0)/greatest(1, poss.possible))::int else 0 end as adherence_pct
  from t
  left join eff on eff.id = t.id
  left join poss on poss.team_id = t.id
  left join ach on ach.team_id = t.id;
$$;

create or replace function public.division_adherence_window_v2(_start timestamptz, _end timestamptz, _leader_multiplier numeric)
returns table(division_id text, team_count integer, member_count integer, possible integer, achieved integer, adherence_pct integer)
language sql
stable
security definer
set search_path = public
as $$
  with td as (
    select t.id as team_id,
           coalesce(c.division_id, public.derive_division_from_team_id(t.id)) as division_id
    from public.teams t
    left join public.coordinations c on c.id = t.coord_id
    where upper(t.id) <> 'CONVIDADOS'
  ),
  per_team as (
    select td.team_id,
           td.division_id,
           floor(
             (select
                (count(*) filter (where coalesce(p.is_leader,false)=false))::numeric
                + (count(*) filter (where coalesce(p.is_leader,false)=true))::numeric * greatest(coalesce(_leader_multiplier,0),0)
              from public.profiles p
              where p.team_id = td.team_id and upper(coalesce(p.team_id,'')) <> 'CONVIDADOS'
             )
           )::int as member_count,
           public.xp_possible_for_team_v2(_start, _end, td.team_id, _leader_multiplier) as possible,
           public.xp_achieved_for_team_v2(_start, _end, td.team_id, _leader_multiplier) as achieved
    from td
  ),
  per_div as (
    select division_id,
           count(*) filter (where team_id is not null)::int as team_count,
           coalesce(sum(member_count),0)::int as member_count,
           coalesce(sum(possible),0)::int as possible,
           coalesce(sum(achieved),0)::int as achieved
    from per_team
    group by division_id
  ),
  djt as (
    select 'DJT'::text as division_id,
           coalesce(sum(team_count),0)::int as team_count,
           coalesce(sum(member_count),0)::int as member_count,
           coalesce(sum(possible),0)::int as possible,
           coalesce(sum(achieved),0)::int as achieved
    from per_div
  )
  select division_id,
         team_count,
         member_count,
         possible,
         achieved,
         case when possible > 0 then round(100.0*achieved/greatest(1,possible))::int else 0 end as adherence_pct
  from (
    select * from per_div
    union all
    select * from djt
  ) x;
$$;

create or replace function public.coord_adherence_window_v2(_start timestamptz, _end timestamptz, _coord_id text, _leader_multiplier numeric)
returns table(team_count integer, member_count integer, possible integer, achieved integer, adherence_pct integer)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select id as team_id
    from public.teams
    where coord_id = _coord_id
      and upper(id) <> 'CONVIDADOS'
  ),
  per_team as (
    select t.team_id,
           floor(
             (select
                (count(*) filter (where coalesce(p.is_leader,false)=false))::numeric
                + (count(*) filter (where coalesce(p.is_leader,false)=true))::numeric * greatest(coalesce(_leader_multiplier,0),0)
              from public.profiles p
              where p.team_id = t.team_id and upper(coalesce(p.team_id,'')) <> 'CONVIDADOS'
             )
           )::int as member_count,
           public.xp_possible_for_team_v2(_start, _end, t.team_id, _leader_multiplier) as possible,
           public.xp_achieved_for_team_v2(_start, _end, t.team_id, _leader_multiplier) as achieved
    from t
  )
  select
    count(*)::int as team_count,
    coalesce(sum(member_count),0)::int as member_count,
    coalesce(sum(possible),0)::int as possible,
    coalesce(sum(achieved),0)::int as achieved,
    case when coalesce(sum(possible),0) > 0 then round(100.0*coalesce(sum(achieved),0)/greatest(1, coalesce(sum(possible),0)))::int else 0 end as adherence_pct
  from per_team;
$$;

