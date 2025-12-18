-- Exclude CONVIDADOS from team-based aggregates (rankings, dashboards, adherence)

-- Ensure we can update view signatures safely across environments
drop view if exists public.team_challenge_performance cascade;
drop view if exists public.team_xp_summary cascade;

-- Views used by leader dashboards
create or replace view public.team_xp_summary as
select
  t.id as team_id,
  t.name as team_name,
  count(p.id) filter (where coalesce(p.is_leader,false) = false) as collaborator_count,
  coalesce(avg(p.xp) filter (where coalesce(p.is_leader,false) = false), 0)::int as avg_xp,
  coalesce(sum(p.xp) filter (where coalesce(p.is_leader,false) = false), 0)::int as total_xp,
  max(p.xp) filter (where coalesce(p.is_leader,false) = false) as max_xp,
  min(p.xp) filter (where coalesce(p.is_leader,false) = false) as min_xp
from public.teams t
left join public.profiles p on p.team_id = t.id
where upper(t.id) <> 'CONVIDADOS'
group by t.id, t.name;

alter view if exists public.team_xp_summary set (security_invoker = true);

create or replace view public.team_challenge_performance as
with base as (
  select 
    p.team_id,
    e.challenge_id,
    count(distinct e.user_id) filter (where e.status in ('submitted','approved','rejected')) as participants_count,
    count(*) filter (where e.status = 'approved') as approvals,
    count(*) as total_events
  from public.events e
  join public.profiles p on p.id = e.user_id
  where p.team_id is not null and upper(p.team_id) <> 'CONVIDADOS'
  group by 1,2
), members as (
  select team_id, count(*) filter (where coalesce(is_leader,false)=false) as total_members
  from public.profiles
  where team_id is not null and upper(team_id) <> 'CONVIDADOS'
  group by 1
)
select
  b.team_id,
  b.challenge_id,
  c.title as challenge_title,
  100.0 * b.participants_count / nullif(m.total_members,0) as adhesion_percentage,
  100.0 * b.approvals / nullif(b.total_events,0) as completion_percentage,
  b.participants_count,
  m.total_members,
  avg(coalesce(c.xp_reward,0))::float as avg_xp_earned
from base b
left join members m on m.team_id = b.team_id
left join public.challenges c on c.id = b.challenge_id
group by b.team_id, b.challenge_id, c.title, b.participants_count, b.approvals, m.total_members, b.total_events;

alter view if exists public.team_challenge_performance set (security_invoker = true);

-- Adherence helpers: ignore guest team in per-team/per-division computations
create or replace function public.team_member_count(_team_id text)
returns integer language sql stable as $$
  select coalesce(count(*),0)::int
  from public.profiles p
  where p.team_id = _team_id
    and coalesce(p.is_leader,false) = false
    and upper(coalesce(p.team_id,'')) <> 'CONVIDADOS'
$$;

create or replace function public.xp_possible_for_team(_start timestamptz, _end timestamptz, _team_id text)
returns integer language plpgsql security definer set search_path=public as $$
declare
  _coord text;
  _div text;
  _members int;
  _sum int := 0;
begin
  if upper(coalesce(_team_id,'')) = 'CONVIDADOS' then
    return 0;
  end if;

  select t.coord_id, coalesce(c.division_id, public.derive_division_from_team_id(_team_id))
    into _coord, _div
  from public.teams t
  left join public.coordinations c on c.id = t.coord_id
  where t.id = _team_id;

  _members := public.team_member_count(_team_id);
  if _members is null then _members := 0; end if;
  if _members = 0 then
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

  return _sum * _members;
end;
$$;

create or replace function public.xp_achieved_for_team(_start timestamptz, _end timestamptz, _team_id text)
returns integer language sql stable as $$
  select coalesce(sum(e.final_points),0)::int
  from public.events e
  join public.profiles p on p.id = e.user_id
  where e.created_at between _start and _end
    and p.team_id = _team_id
    and upper(coalesce(_team_id,'')) <> 'CONVIDADOS'
    and upper(coalesce(p.team_id,'')) <> 'CONVIDADOS'
    and coalesce(p.is_leader,false) = false
$$;

create or replace function public.team_adherence_window(_start timestamptz, _end timestamptz)
returns table(team_id text, member_count integer, possible integer, achieved integer, adherence_pct integer)
language sql stable as $$
  with t as (
    select id from public.teams where upper(id) <> 'CONVIDADOS'
  ),
  mc as (
    select p.team_id as id, count(*)::int as members
    from public.profiles p
    where p.team_id is not null and upper(p.team_id) <> 'CONVIDADOS' and coalesce(p.is_leader,false) = false
    group by p.team_id
  ),
  poss as (
    select id as team_id, public.xp_possible_for_team(_start, _end, id) as possible from t
  ),
  ach as (
    select id as team_id, public.xp_achieved_for_team(_start, _end, id) as achieved from t
  )
  select t.id,
         coalesce(mc.members,0) as member_count,
         coalesce(poss.possible,0) as possible,
         coalesce(ach.achieved,0) as achieved,
         case when coalesce(poss.possible,0) > 0 then round(100.0*coalesce(ach.achieved,0)/greatest(1, poss.possible))::int else 0 end as adherence_pct
  from t
  left join mc on mc.id = t.id
  left join poss on poss.team_id = t.id
  left join ach on ach.team_id = t.id
$$;

create or replace function public.division_adherence_window(_start timestamptz, _end timestamptz)
returns table(division_id text, team_count integer, member_count integer, possible integer, achieved integer, adherence_pct integer)
language sql stable as $$
  with td as (
    select t.id as team_id,
           coalesce(c.division_id, public.derive_division_from_team_id(t.id)) as division_id
    from public.teams t
    left join public.coordinations c on c.id = t.coord_id
    where upper(t.id) <> 'CONVIDADOS'
  ),
  mc as (
    select p.team_id, count(*)::int as members
    from public.profiles p
    where p.team_id is not null and upper(p.team_id) <> 'CONVIDADOS' and coalesce(p.is_leader,false) = false
    group by p.team_id
  ),
  per_team as (
    select td.team_id,
           td.division_id,
           coalesce(mc.members,0) as member_count,
           public.xp_possible_for_team(_start, _end, td.team_id) as possible,
           public.xp_achieved_for_team(_start, _end, td.team_id) as achieved
    from td
    left join mc on mc.team_id = td.team_id
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
  ) x
$$;
