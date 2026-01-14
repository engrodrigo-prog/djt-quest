-- Ensure immediate leader is assigned first; second leader only after first evaluation.
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
  eval_count int;
  first_reviewer uuid;
begin
  select e.user_id, p.team_id, p.coord_id, p.division_id
    into _submitter, _team, _coord, _div
  from public.events e
  join public.profiles p on p.id = e.user_id
  where e.id = _event_id;

  if _submitter is null then
    return;
  end if;

  select count(*) into eval_count from public.action_evaluations where event_id = _event_id;
  select reviewer_id into first_reviewer
  from public.action_evaluations
  where event_id = _event_id
  order by created_at
  limit 1;

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

  -- Random leader: prefer leaders outside the submitter team; rotate by pending/last assignment.
  with candidates as (
    select p.id as user_id,
           coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p.id and eq.completed_at is null),0) as pending,
           coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p.id), to_timestamp(0)) as last_assigned
    from public.profiles p
    where p.is_leader = true
      and p.id <> _submitter
      and p.id <> coalesce(c_immediate, '00000000-0000-0000-0000-000000000000')::uuid
      and p.id <> coalesce(first_reviewer, '00000000-0000-0000-0000-000000000000')::uuid
      and (p.team_id is distinct from _team)
  )
  select user_id into c_random
  from candidates
  order by pending asc, last_assigned asc, random()
  limit 1;

  -- Fallback: if there is no leader outside the submitter team, pick any other leader (still excluding submitter/immediate/first reviewer)
  if c_random is null then
    with candidates2 as (
      select p.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p.id), to_timestamp(0)) as last_assigned
      from public.profiles p
      where p.is_leader = true
        and p.id <> _submitter
        and p.id <> coalesce(c_immediate, '00000000-0000-0000-0000-000000000000')::uuid
        and p.id <> coalesce(first_reviewer, '00000000-0000-0000-0000-000000000000')::uuid
    )
    select user_id into c_random
    from candidates2
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  if eval_count < 1 then
    if c_immediate is not null then
      insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
      values (_event_id, c_immediate, now(), false)
      on conflict (event_id, assigned_to) where assigned_to is not null do nothing;
    elsif c_random is not null then
      insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
      values (_event_id, c_random, now(), true)
      on conflict (event_id, assigned_to) where assigned_to is not null do nothing;
    end if;
  else
    if c_random is not null then
      insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
      values (_event_id, c_random, now(), true)
      on conflict (event_id, assigned_to) where assigned_to is not null do nothing;
    end if;
  end if;
end;
$$;

