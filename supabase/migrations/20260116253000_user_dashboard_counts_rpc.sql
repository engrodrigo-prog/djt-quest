-- Fast dashboard counts for badges (campaigns/challenges/quizzes) to avoid large client-side scans.
-- Used by /api/admin?handler=studio-pending-counts.

create or replace function public.user_dashboard_counts(u uuid)
returns table(campaigns integer, challenges_active integer, quizzes_pending integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  _team text;
  _coord text;
  _div text;
  _is_leader boolean := false;
  _now timestamptz := now();
begin
  select p.team_id::text, p.coord_id::text, p.division_id::text, coalesce(p.is_leader,false)
    into _team, _coord, _div, _is_leader
  from public.profiles p
  where p.id = u;

  -- Active campaigns (date or timestamptz compatible)
  select coalesce(count(*),0)::int into campaigns
  from public.campaigns c
  where coalesce(c.is_active,true) = true
    and (_now >= coalesce(c.start_date::timestamptz, '-infty'::timestamptz))
    and (_now <= coalesce(c.end_date::timestamptz, 'infty'::timestamptz));

  -- Active non-quiz challenges eligible for the user
  select coalesce(count(*),0)::int into challenges_active
  from public.challenges ch
  where lower(coalesce(ch.status,'active')) not in ('closed','canceled','cancelled')
    and lower(ch.type::text) <> 'quiz'
    and (_now >= coalesce(ch.start_date, '-infty'::timestamptz))
    and (_now <= coalesce(ch.due_date, 'infty'::timestamptz))
    and (coalesce(ch.audience,'all') <> 'leaders' or _is_leader = true)
    and (
      (ch.target_team_ids is null and ch.target_coord_ids is null and ch.target_div_ids is null)
      or (_team is not null and ch.target_team_ids is not null and _team = any(ch.target_team_ids::text[]))
      or (_coord is not null and ch.target_coord_ids is not null and _coord = any(ch.target_coord_ids::text[]))
      or (_div is not null and ch.target_div_ids is not null and _div = any(ch.target_div_ids::text[]))
    );

  -- Pending quizzes (eligible + not yet submitted)
  select coalesce(count(*),0)::int into quizzes_pending
  from public.challenges ch
  where lower(coalesce(ch.status,'active')) not in ('closed','canceled','cancelled')
    and lower(ch.type::text) = 'quiz'
    and (_now >= coalesce(ch.start_date, '-infty'::timestamptz))
    and (_now <= coalesce(ch.due_date, 'infty'::timestamptz))
    and (coalesce(ch.audience,'all') <> 'leaders' or _is_leader = true)
    and (
      (ch.target_team_ids is null and ch.target_coord_ids is null and ch.target_div_ids is null)
      or (_team is not null and ch.target_team_ids is not null and _team = any(ch.target_team_ids::text[]))
      or (_coord is not null and ch.target_coord_ids is not null and _coord = any(ch.target_coord_ids::text[]))
      or (_div is not null and ch.target_div_ids is not null and _div = any(ch.target_div_ids::text[]))
    )
    and not exists (
      select 1
      from public.quiz_attempts qa
      where qa.user_id = u
        and qa.challenge_id = ch.id
        and qa.submitted_at is not null
    );

  return next;
end;
$$;

