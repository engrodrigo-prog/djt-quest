-- Fix: avoid collision between real division_id='DJT' and the synthetic global row.
-- Global row uses division_id='DJT_GLOBAL'.

create or replace function public.division_adherence_window(_start timestamptz, _end timestamptz)
returns table(division_id text, team_count integer, member_count integer, possible integer, achieved integer, adherence_pct integer)
language sql
stable
set search_path = public
as $$
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
    select 'DJT_GLOBAL'::text as division_id,
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
    select 'DJT_GLOBAL'::text as division_id,
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

