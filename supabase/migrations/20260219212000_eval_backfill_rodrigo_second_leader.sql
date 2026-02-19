-- Ensure "requires two evaluations" events always get a 2nd assignee when possible,
-- preferring division managers/coordinators (below top hierarchy) as fallback.
-- Also backfill pending events from Rodrigo Nascimento that are missing an assignee.

create or replace function public.assign_evaluators_for_event(_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_immediate uuid;
  c_random uuid;
  c_admin uuid;
  c_fallback uuid;
  _submitter uuid;
  _team text;
  _coord text;
  _div text;
  _sigla text;
  _base text;
  immediate_coord text;
  target_coord text;
  requires_two boolean;
  is_campaign boolean;
  submitter_is_guest boolean;
  existing_assignees int;
  existing_evals int;
begin
  select e.user_id,
         p.team_id,
         p.coord_id,
         p.division_id,
         p.sigla_area,
         p.operational_base,
         (
           e.challenge_id is null
           or coalesce(c.require_two_leader_eval, false)
           or coalesce((e.payload->>'source') = 'campaign_evidence', false)
         ) as requires_two,
         (
           coalesce((e.payload->>'source') = 'campaign_evidence', false)
           or c.campaign_id is not null
         ) as is_campaign
    into _submitter, _team, _coord, _div, _sigla, _base, requires_two, is_campaign
  from public.events e
  join public.profiles p on p.id = e.user_id
  left join public.challenges c on c.id = e.challenge_id
  where e.id = _event_id;

  if _submitter is null then
    return;
  end if;

  select (
      exists (select 1 from public.user_roles ur where ur.user_id = _submitter and ur.role = 'invited')
      or upper(coalesce(_team, '')) in ('CONVIDADOS', 'EXTERNO')
      or upper(coalesce(_sigla, '')) in ('CONVIDADOS', 'EXTERNO')
      or upper(coalesce(_base, '')) in ('CONVIDADOS', 'EXTERNO')
      or upper(coalesce(_coord, '')) in ('CONVIDADOS', 'EXTERNO')
      or upper(coalesce(_div, '')) in ('CONVIDADOS', 'EXTERNO')
    )
    into submitter_is_guest;

  -- Guest campaign override: assign only Rodrigo Nascimento (single evaluation).
  if submitter_is_guest and is_campaign then
    select p2.id into c_admin
    from public.profiles p2
    where p2.id <> _submitter
      and (
        lower(coalesce(p2.email,'')) = 'rodrigonasc@cpfl.com.br'
        or p2.name ilike 'rodrigo% nascimento%'
      )
    order by p2.id
    limit 1;

    if c_admin is not null then
      -- Force single pending assignment to Rodrigo (do not touch completed rows).
      delete from public.evaluation_queue
      where event_id = _event_id
        and completed_at is null
        and assigned_to is not null
        and assigned_to <> c_admin;

      insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
      values (_event_id, c_admin, now(), false)
      on conflict (event_id, assigned_to) where assigned_to is not null do nothing;

      return;
    end if;
  end if;

  -- Guest campaign override (admin/cintia/rodrigo) from older flows:
  -- if there are evaluations already, do not interfere.
  if submitter_is_guest and is_campaign then
    select count(*) into existing_evals from public.action_evaluations where event_id = _event_id;
    if coalesce(existing_evals, 0) > 0 then
      return;
    end if;
  end if;

  -- Default logic (leader imediato + líder randômico), aligned with parallel evaluations.
  select count(distinct assigned_to)
    into existing_assignees
    from public.evaluation_queue eq
   where eq.event_id = _event_id
     and eq.assigned_to is not null
     and eq.completed_at is null;

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
     and eq.assigned_to is not null
     and eq.completed_at is null;

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

  -- Random leader: prefer leaders outside the submitter team AND in a different coordination.
  if target_coord is not null then
    with candidates as (
      select p3.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p3.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p3.id), to_timestamp(0)) as last_assigned
      from public.profiles p3
      where p3.is_leader = true
        and p3.id <> _submitter
        and not exists (select 1 from public.evaluation_queue eq3 where eq3.event_id = _event_id and eq3.assigned_to = p3.id and eq3.completed_at is null)
        and (p3.team_id is distinct from _team)
        and (p3.coord_id is distinct from target_coord)
    )
    select user_id into c_random
    from candidates
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  -- Fallback: allow same coordination (still outside submitter team).
  if c_random is null then
    with candidates2 as (
      select p4.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p4.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p4.id), to_timestamp(0)) as last_assigned
      from public.profiles p4
      where p4.is_leader = true
        and p4.id <> _submitter
        and not exists (select 1 from public.evaluation_queue eq3 where eq3.event_id = _event_id and eq3.assigned_to = p4.id and eq3.completed_at is null)
        and (p4.team_id is distinct from _team)
    )
    select user_id into c_random
    from candidates2
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  -- Final fallback: any other leader not yet assigned.
  if c_random is null then
    with candidates3 as (
      select p5.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p5.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p5.id), to_timestamp(0)) as last_assigned
      from public.profiles p5
      where p5.is_leader = true
        and p5.id <> _submitter
        and not exists (select 1 from public.evaluation_queue eq3 where eq3.event_id = _event_id and eq3.assigned_to = p5.id and eq3.completed_at is null)
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

  -- If we still need a second evaluator, prefer a manager/coordinator below the top hierarchy.
  if requires_two then
    loop
      select count(distinct assigned_to)
        into existing_assignees
        from public.evaluation_queue eq
       where eq.event_id = _event_id
         and eq.assigned_to is not null
         and eq.completed_at is null;

      exit when existing_assignees >= 2;

      with candidates as (
        select
          p6.id as user_id,
          min(
            case ur.role
              when 'gerente_divisao_djtx' then 1
              when 'coordenador_djtx' then 2
              when 'gerente_djt' then 3
              else 9
            end
          ) as role_rank,
          case when p6.division_id is not distinct from _div then 0 else 1 end as div_rank,
          coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p6.id and eq.completed_at is null),0) as pending,
          coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p6.id), to_timestamp(0)) as last_assigned
        from public.profiles p6
        join public.user_roles ur on ur.user_id = p6.id
        where p6.id <> _submitter
          and ur.role in ('gerente_divisao_djtx','coordenador_djtx','gerente_djt')
          and not exists (
            select 1 from public.evaluation_queue eq3
            where eq3.event_id = _event_id
              and eq3.assigned_to = p6.id
              and eq3.completed_at is null
          )
        group by p6.id, div_rank
      )
      select user_id into c_fallback
      from candidates
      order by div_rank asc, role_rank asc, pending asc, last_assigned asc, random()
      limit 1;

      exit when c_fallback is null;

      insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
      values (_event_id, c_fallback, now(), true)
      on conflict (event_id, assigned_to) where assigned_to is not null do nothing;
    end loop;
  end if;
end;
$$;

-- NOTE: Backfilling existing pending events is intentionally performed outside migrations
-- to avoid statement timeouts on large datasets. Use `supabase db query` to call
-- `public.assign_evaluators_for_event(<event_id>)` for specific stuck events.
