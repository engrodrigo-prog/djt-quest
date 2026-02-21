-- Fix: events awaiting 2nd evaluation can get stuck with no pending evaluator (queue rows completed/cleared).
-- Ensure `assign_evaluators_for_event` reopens/assigns an evaluator when `action_evaluations` has 1 row but
-- there is no open `evaluation_queue` row for someone who hasn't evaluated yet.

create or replace function public.assign_evaluators_for_event(_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_primary uuid;
  c_cross uuid;
  c_admin uuid;
  c_fallback uuid;
  _submitter uuid;
  _team text;
  _coord text;
  _div text;
  _sigla text;
  _base text;
  primary_coord text;
  target_coord text;
  requires_two boolean;
  is_campaign boolean;
  submitter_is_guest boolean;
  eval_count int;
  remaining_needed int;
  open_remaining int;
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

  -- Campaigns always require two assignments (primary + cross).
  requires_two := coalesce(requires_two, false) or coalesce(is_campaign, false);

  -- Remove any placeholder/pending rows without assignee for this event.
  delete from public.evaluation_queue
   where event_id = _event_id
     and completed_at is null
     and assigned_to is null;

  select count(*) into eval_count
  from public.action_evaluations ae
  where ae.event_id = _event_id;

  if coalesce(eval_count, 0) >= (case when requires_two then 2 else 1 end) then
    return;
  end if;

  remaining_needed := (case when requires_two then 2 else 1 end) - coalesce(eval_count, 0);

  -- Count open queue rows for evaluators that have NOT evaluated yet.
  select count(distinct eq.assigned_to)
    into open_remaining
    from public.evaluation_queue eq
   where eq.event_id = _event_id
     and eq.assigned_to is not null
     and eq.completed_at is null
     and not exists (
       select 1 from public.action_evaluations ae
       where ae.event_id = _event_id and ae.reviewer_id = eq.assigned_to
     );

  if coalesce(open_remaining, 0) >= remaining_needed then
    return;
  end if;

  -- Reopen existing assignee(s) (completed rows) that have not evaluated yet.
  with to_reopen as (
    select eq2.id
    from public.evaluation_queue eq2
    where eq2.event_id = _event_id
      and eq2.assigned_to is not null
      and eq2.completed_at is not null
      and not exists (
        select 1 from public.action_evaluations ae
        where ae.event_id = _event_id and ae.reviewer_id = eq2.assigned_to
      )
    order by coalesce(eq2.is_cross_evaluation, false) desc, eq2.completed_at desc
    limit greatest(0, remaining_needed - coalesce(open_remaining, 0))
  )
  update public.evaluation_queue q
     set completed_at = null,
         assigned_at = coalesce(q.assigned_at, now())
   where q.id in (select id from to_reopen);

  select count(distinct eq.assigned_to)
    into open_remaining
    from public.evaluation_queue eq
   where eq.event_id = _event_id
     and eq.assigned_to is not null
     and eq.completed_at is null
     and not exists (
       select 1 from public.action_evaluations ae
       where ae.event_id = _event_id and ae.reviewer_id = eq.assigned_to
     );

  if coalesce(open_remaining, 0) >= remaining_needed then
    return;
  end if;

  -- Detect guest submitter.
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

  -- PRIMARY evaluator (prefer immediate leader by hierarchy: team -> coordination -> division),
  -- detected by profiles.is_leader OR leadership roles.
  select p0.id into c_primary
  from public.profiles p0
  where p0.id <> _submitter
    and p0.team_id = _team
    and (
      coalesce(p0.is_leader,false) = true
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = p0.id and ur.role in ('lider_equipe','coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
      )
    )
    and not exists (select 1 from public.evaluation_queue eqx where eqx.event_id = _event_id and eqx.assigned_to = p0.id)
    and not exists (select 1 from public.action_evaluations ae where ae.event_id = _event_id and ae.reviewer_id = p0.id)
  order by p0.id
  limit 1;

  if c_primary is null then
    select p1.id into c_primary
    from public.profiles p1
    where p1.id <> _submitter
      and p1.coord_id = _coord
      and (
        coalesce(p1.is_leader,false) = true
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = p1.id and ur.role in ('lider_equipe','coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
        )
      )
      and not exists (select 1 from public.evaluation_queue eqx where eqx.event_id = _event_id and eqx.assigned_to = p1.id)
      and not exists (select 1 from public.action_evaluations ae where ae.event_id = _event_id and ae.reviewer_id = p1.id)
    order by p1.id
    limit 1;
  end if;

  if c_primary is null then
    select p2.id into c_primary
    from public.profiles p2
    where p2.id <> _submitter
      and p2.division_id = _div
      and (
        coalesce(p2.is_leader,false) = true
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = p2.id and ur.role in ('lider_equipe','coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
        )
      )
      and not exists (select 1 from public.evaluation_queue eqx where eqx.event_id = _event_id and eqx.assigned_to = p2.id)
      and not exists (select 1 from public.action_evaluations ae where ae.event_id = _event_id and ae.reviewer_id = p2.id)
    order by p2.id
    limit 1;
  end if;

  if c_primary is null then
    with candidates0 as (
      select p3.id as user_id,
             case when _coord is not null and p3.coord_id is not distinct from _coord then 0 else 1 end as coord_rank,
             case when _div is not null and p3.division_id is not distinct from _div then 0 else 1 end as div_rank,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p3.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p3.id), to_timestamp(0)) as last_assigned
      from public.profiles p3
      where p3.id <> _submitter
        and (
          coalesce(p3.is_leader,false) = true
          or exists (
            select 1 from public.user_roles ur
            where ur.user_id = p3.id and ur.role in ('lider_equipe','coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
          )
        )
        and not exists (select 1 from public.evaluation_queue eqx where eqx.event_id = _event_id and eqx.assigned_to = p3.id)
        and not exists (select 1 from public.action_evaluations ae where ae.event_id = _event_id and ae.reviewer_id = p3.id)
    )
    select user_id into c_primary
    from candidates0
    order by coord_rank asc, div_rank asc, pending asc, last_assigned asc, random()
    limit 1;
  end if;

  if c_primary is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
    values (_event_id, c_primary, now(), false)
    on conflict (event_id, assigned_to) where assigned_to is not null do nothing;
  end if;

  if not requires_two then
    return;
  end if;

  if c_primary is not null then
    select coord_id into primary_coord from public.profiles where id = c_primary;
  else
    primary_coord := null;
  end if;
  target_coord := coalesce(primary_coord, _coord);

  -- CROSS evaluator: prefer leaders outside the submitter team AND in a different coordination.
  if target_coord is not null then
    with candidates as (
      select p4.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p4.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p4.id), to_timestamp(0)) as last_assigned
      from public.profiles p4
      where p4.id <> _submitter
        and (
          coalesce(p4.is_leader,false) = true
          or exists (
            select 1 from public.user_roles ur
            where ur.user_id = p4.id and ur.role in ('lider_equipe','coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
          )
        )
        and not exists (select 1 from public.evaluation_queue eqx where eqx.event_id = _event_id and eqx.assigned_to = p4.id)
        and not exists (select 1 from public.action_evaluations ae where ae.event_id = _event_id and ae.reviewer_id = p4.id)
        and (p4.team_id is distinct from _team)
        and (p4.coord_id is distinct from target_coord)
    )
    select user_id into c_cross
    from candidates
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  if c_cross is null then
    with candidates2 as (
      select p5.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p5.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p5.id), to_timestamp(0)) as last_assigned
      from public.profiles p5
      where p5.id <> _submitter
        and (
          coalesce(p5.is_leader,false) = true
          or exists (
            select 1 from public.user_roles ur
            where ur.user_id = p5.id and ur.role in ('lider_equipe','coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
          )
        )
        and not exists (select 1 from public.evaluation_queue eqx where eqx.event_id = _event_id and eqx.assigned_to = p5.id)
        and not exists (select 1 from public.action_evaluations ae where ae.event_id = _event_id and ae.reviewer_id = p5.id)
        and (p5.team_id is distinct from _team)
    )
    select user_id into c_cross
    from candidates2
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  if c_cross is null then
    with candidates3 as (
      select p6.id as user_id,
             coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p6.id and eq.completed_at is null),0) as pending,
             coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p6.id), to_timestamp(0)) as last_assigned
      from public.profiles p6
      where p6.id <> _submitter
        and (
          coalesce(p6.is_leader,false) = true
          or exists (
            select 1 from public.user_roles ur
            where ur.user_id = p6.id and ur.role in ('lider_equipe','coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
          )
        )
        and not exists (select 1 from public.evaluation_queue eqx where eqx.event_id = _event_id and eqx.assigned_to = p6.id)
        and not exists (select 1 from public.action_evaluations ae where ae.event_id = _event_id and ae.reviewer_id = p6.id)
    )
    select user_id into c_cross
    from candidates3
    order by pending asc, last_assigned asc, random()
    limit 1;
  end if;

  if c_cross is null then
    with candidates4 as (
      select
        p7.id as user_id,
        min(
          case ur.role
            when 'gerente_divisao_djtx' then 1
            when 'coordenador_djtx' then 2
            when 'lider_equipe' then 3
            when 'gerente_djt' then 4
            when 'admin' then 5
            else 9
          end
        ) as role_rank,
        case when _div is not null and p7.division_id is not distinct from _div then 0 else 1 end as div_rank,
        coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = p7.id and eq.completed_at is null),0) as pending,
        coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = p7.id), to_timestamp(0)) as last_assigned
      from public.profiles p7
      left join public.user_roles ur on ur.user_id = p7.id
      where p7.id <> _submitter
        and (
          coalesce(p7.is_leader,false) = true
          or ur.role in ('lider_equipe','coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin')
        )
        and not exists (select 1 from public.evaluation_queue eqx where eqx.event_id = _event_id and eqx.assigned_to = p7.id)
        and not exists (select 1 from public.action_evaluations ae where ae.event_id = _event_id and ae.reviewer_id = p7.id)
      group by p7.id, div_rank
    )
    select user_id into c_fallback
    from candidates4
    order by div_rank asc, role_rank asc, pending asc, last_assigned asc, random()
    limit 1;
    c_cross := c_fallback;
  end if;

  if c_cross is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
    values (_event_id, c_cross, now(), true)
    on conflict (event_id, assigned_to) where assigned_to is not null do nothing;
  end if;

  delete from public.evaluation_queue
   where event_id = _event_id
     and completed_at is null
     and assigned_to is null;
end;
$$;

-- Backfill: ensure awaiting_second_evaluation events have an open assignee for the 2nd evaluation.
do $$
declare
  ev record;
  processed int := 0;
begin
  for ev in
    select e.id as event_id
      from public.events e
     where e.status::text = 'awaiting_second_evaluation'
       and coalesce(e.awaiting_second_evaluation, false) = true
       and (select count(*) from public.action_evaluations ae where ae.event_id = e.id) = 1
       and (
         select count(*)
         from public.evaluation_queue eq
         where eq.event_id = e.id
           and eq.assigned_to is not null
           and eq.completed_at is null
           and not exists (
             select 1 from public.action_evaluations ae2
             where ae2.event_id = e.id and ae2.reviewer_id = eq.assigned_to
           )
       ) = 0
     order by e.created_at desc
     limit 250
  loop
    perform public.assign_evaluators_for_event(ev.event_id);
    processed := processed + 1;
  end loop;

  raise notice 'Repair awaiting_second missing assignee: processed=%', processed;
end $$;

