-- Allow parallel evaluations: assign both evaluators up-front (when required),
-- instead of enforcing an evaluation order.

create or replace function public.assign_evaluators_for_event(_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_immediate uuid;
  c_random uuid;
  _submitter uuid;
  _team text;
  _coord text;
  _div text;
  immediate_coord text;
  target_coord text;
  requires_two boolean;
  existing_assignees int;
begin
  select e.user_id,
         p.team_id,
         p.coord_id,
         p.division_id,
         (
           coalesce(c.require_two_leader_eval, false)
           or coalesce((e.payload->>'source') = 'campaign_evidence', false)
         )
    into _submitter, _team, _coord, _div, requires_two
  from public.events e
  join public.profiles p on p.id = e.user_id
  left join public.challenges c on c.id = e.challenge_id
  where e.id = _event_id;

  if _submitter is null then
    return;
  end if;

  select count(distinct assigned_to)
    into existing_assignees
    from public.evaluation_queue eq
   where eq.event_id = _event_id
     and eq.assigned_to is not null;

  -- For simple evaluations, ensure only one assignee exists.
  if not requires_two then
    if existing_assignees >= 1 then
      return;
    end if;
  else
    -- For double evaluations, ensure no more than two assignees.
    if existing_assignees >= 2 then
      return;
    end if;
  end if;

  -- Immediate leader: same team leader if exists; fallback to any leader in same coordination/division.
  select id into c_immediate
  from public.profiles
  where is_leader = true
    and team_id = _team
    and id <> _submitter
  order by id
  limit 1;

  if c_immediate is null then
    select id into c_immediate
    from public.profiles
    where is_leader = true
      and coord_id = _coord
      and id <> _submitter
    order by id
    limit 1;
  end if;

  if c_immediate is null then
    select id into c_immediate
    from public.profiles
    where is_leader = true
      and division_id = _div
      and id <> _submitter
    order by id
    limit 1;
  end if;

  if c_immediate is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
    values (_event_id, c_immediate, now(), false)
    on conflict (event_id, assigned_to) where assigned_to is not null do nothing;
  end if;

  select count(distinct assigned_to)
    into existing_assignees
    from public.evaluation_queue eq
   where eq.event_id = _event_id
     and eq.assigned_to is not null;

  -- If we only need one evaluation (or already have two), stop here.
  if (not requires_two and existing_assignees >= 1) or (requires_two and existing_assignees >= 2) then
    return;
  end if;

  if c_immediate is not null then
    select coord_id into immediate_coord from public.profiles where id = c_immediate;
  else
    immediate_coord := null;
  end if;
  target_coord := coalesce(immediate_coord, _coord);

  -- Random leader: prefer leaders outside the submitter team AND in a different coordination
  -- (so 2ª avaliação não fica bloqueada pela regra de coordenação).
  if target_coord is not null then
    with candidates as (
      select p.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p.id), to_timestamp(0)) as last_assigned
      from public.profiles p
      where p.is_leader = true
        and p.id <> _submitter
        and not exists (select 1 from public.evaluation_queue eq3 where eq3.event_id = _event_id and eq3.assigned_to = p.id)
        and (p.team_id is distinct from _team)
        and (p.coord_id is distinct from target_coord)
    )
    select user_id into c_random
    from candidates
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  -- Fallback: allow same coordination (still outside submitter team).
  if c_random is null then
    with candidates2 as (
      select p.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p.id), to_timestamp(0)) as last_assigned
      from public.profiles p
      where p.is_leader = true
        and p.id <> _submitter
        and not exists (select 1 from public.evaluation_queue eq3 where eq3.event_id = _event_id and eq3.assigned_to = p.id)
        and (p.team_id is distinct from _team)
    )
    select user_id into c_random
    from candidates2
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  -- Final fallback: any other leader not yet assigned.
  if c_random is null then
    with candidates3 as (
      select p.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p.id), to_timestamp(0)) as last_assigned
      from public.profiles p
      where p.is_leader = true
        and p.id <> _submitter
        and not exists (select 1 from public.evaluation_queue eq3 where eq3.event_id = _event_id and eq3.assigned_to = p.id)
    )
    select user_id into c_random
    from candidates3
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  if c_random is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
    values (_event_id, c_random, now(), true)
    on conflict (event_id, assigned_to) where assigned_to is not null do nothing;
  end if;
end;
$$;

