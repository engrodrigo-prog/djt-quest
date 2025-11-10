-- Performance indexes for adherence queries
create index if not exists idx_events_user_created_at on public.events(user_id, created_at);
create index if not exists idx_events_created_at on public.events(created_at);
create index if not exists idx_challenges_due_status on public.challenges(due_date, status);
create index if not exists idx_profiles_team_isleader on public.profiles(team_id, is_leader);
create index if not exists idx_teams_coord on public.teams(coord_id);
create index if not exists idx_coords_div on public.coordinations(division_id);

-- GIN for target arrays
create index if not exists idx_challenges_target_team_gin on public.challenges using gin (target_team_ids);
create index if not exists idx_challenges_target_coord_gin on public.challenges using gin (target_coord_ids);
create index if not exists idx_challenges_target_div_gin on public.challenges using gin (target_div_ids);

-- Helper to derive division from team id prefix (e.g., DJTB-CUB -> DJTB)
create or replace function public.derive_division_from_team_id(_team_id text)
returns text language sql stable as $$
  select nullif(split_part(coalesce(_team_id,''), '-', 1), '')
$$;

-- Count members (non-leaders) in a team
create or replace function public.team_member_count(_team_id text)
returns integer language sql stable as $$
  select coalesce(count(*),0)::int
  from public.profiles p
  where p.team_id = _team_id and coalesce(p.is_leader,false) = false
$$;

-- Compute XP possível for a team in a time window
create or replace function public.xp_possible_for_team(_start timestamptz, _end timestamptz, _team_id text)
returns integer language plpgsql security definer set search_path=public as $$
declare
  _coord text;
  _div text;
  _members int;
  _sum int := 0;
begin
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

-- Compute XP atingido for a team in a time window (non-leaders only)
create or replace function public.xp_achieved_for_team(_start timestamptz, _end timestamptz, _team_id text)
returns integer language sql stable as $$
  select coalesce(sum(e.final_points),0)::int
  from public.events e
  join public.profiles p on p.id = e.user_id
  where e.created_at between _start and _end
    and p.team_id = _team_id
    and coalesce(p.is_leader,false) = false
$$;

-- Return adherence per team in window
create or replace function public.team_adherence_window(_start timestamptz, _end timestamptz)
returns table(team_id text, member_count integer, possible integer, achieved integer, adherence_pct integer)
language sql stable as $$
  with t as (select id from public.teams),
  mc as (
    select p.team_id as id, count(*)::int as members
    from public.profiles p
    where p.team_id is not null and coalesce(p.is_leader,false) = false
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

-- Return adherence per division in window (aggregated from teams; includes a DJT global row)
create or replace function public.division_adherence_window(_start timestamptz, _end timestamptz)
returns table(division_id text, team_count integer, member_count integer, possible integer, achieved integer, adherence_pct integer)
language sql stable as $$
  with td as (
    select t.id as team_id,
           coalesce(c.division_id, public.derive_division_from_team_id(t.id)) as division_id
    from public.teams t
    left join public.coordinations c on c.id = t.coord_id
  ),
  mc as (
    select p.team_id, count(*)::int as members
    from public.profiles p
    where p.team_id is not null and coalesce(p.is_leader,false) = false
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

