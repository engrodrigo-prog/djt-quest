-- Division managers mapping
create table if not exists public.division_managers (
  division_id text primary key references public.divisions(id) on delete cascade,
  manager_user_id uuid references public.profiles(id) on delete set null
);

-- Seed managers for DJTB and DJTV by email (best effort)
do $$ begin
  begin
    insert into public.division_managers(division_id, manager_user_id)
    values ('DJTB', (select id from public.profiles where email ilike 'rodrigo%.almeida@cpfl.com.br' or email ilike 'rodrigoalmeida@cpfl.com.br' limit 1))
    on conflict (division_id) do update set manager_user_id = excluded.manager_user_id;
  exception when others then null; end;
  begin
    insert into public.division_managers(division_id, manager_user_id)
    values ('DJTV', (select id from public.profiles where email ilike 'paulo%.camara@cpfl.com.br' or email ilike 'paulo.camara@cpfl.com.br' limit 1))
    on conflict (division_id) do update set manager_user_id = excluded.manager_user_id;
  exception when others then null; end;
end $$;

-- Relax participants enforcement: only ensure at least 1 participant
create or replace function public.enforce_participants_count()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  cnt int;
begin
  select count(*) into cnt from public.event_participants where event_id = coalesce(new.event_id, old.event_id);
  if cnt < 1 then
    raise exception 'Cada ação deve ter pelo menos 1 participante (atual: %)', cnt;
  end if;
  return coalesce(new, old);
end;
$$;

-- Action metadata to avoid duplicates (date, location, SAP note)
alter table public.events add column if not exists action_date date;
alter table public.events add column if not exists action_location text;
alter table public.events add column if not exists sap_service_note text;

-- Unique when all metadata are provided
create unique index if not exists uq_events_dedup_meta
on public.events (challenge_id, action_date, action_location, sap_service_note)
where action_date is not null and action_location is not null and sap_service_note is not null;

-- Rework assignment: immediate leader + random leader + division manager
create or replace function public.assign_evaluators_for_event(_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  c_immediate uuid;
  c_leader uuid;
  c_manager uuid;
  _submitter uuid;
  _team text;
  _coord text;
  _div text;
begin
  select e.user_id, p.team_id, p.coord_id, p.division_id
    into _submitter, _team, _coord, _div
  from public.events e
  join public.profiles p on p.id = e.user_id
  where e.id = _event_id;

  -- immediate leader: same team leader if exists, else same coord/division leader
  select id into c_immediate from public.profiles 
    where is_leader = true and team_id = _team and id <> _submitter limit 1;
  if c_immediate is null then
    select p.id into c_immediate from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.coord_id = _coord and p.id <> _submitter
        and ur.role in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt')
      order by p.id limit 1;
  end if;
  if c_immediate is null then
    select p.id into c_immediate from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.division_id = _div and p.id <> _submitter
        and ur.role in ('coordenador_djtx','gerente_divisao_djtx','gerente_djt')
      order by p.id limit 1;
  end if;

  -- random leader (same division, exclude immediate/submitter, prefer lowest pending)
  with candidates as (
    select ur.user_id,
           coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = ur.user_id and eq.completed_at is null),0) as pending,
           coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = ur.user_id), to_timestamp(0)) as last_assigned
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role in ('coordenador_djtx','gerente_divisao_djtx')
      and p.division_id = _div
      and ur.user_id <> coalesce(c_immediate, '00000000-0000-0000-0000-000000000000')::uuid
      and ur.user_id <> _submitter
  )
  select user_id into c_leader from candidates order by pending asc, last_assigned asc, random() limit 1;

  -- division manager from mapping; fallback to any gerente_djt
  select manager_user_id into c_manager from public.division_managers where division_id = _div;
  if c_manager is null then
    select ur.user_id into c_manager from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'gerente_djt' and p.division_id = _div and ur.user_id <> _submitter
    order by random() limit 1;
  end if;

  -- Insert assignments (ignore duplicates/nulls)
  if c_immediate is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at)
    values (_event_id, c_immediate, now()) on conflict (event_id, assigned_to) do nothing;
  end if;
  if c_leader is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at)
    values (_event_id, c_leader, now()) on conflict (event_id, assigned_to) do nothing;
  end if;
  if c_manager is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at)
    values (_event_id, c_manager, now()) on conflict (event_id, assigned_to) do nothing;
  end if;
end;
$$;

-- Final points only when 3 evaluations are completed
create or replace function public.update_event_points(_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  _avg_rating numeric;
  _cnt int;
  _xp integer;
  _eval_multiplier numeric;
  _team_mod numeric;
begin
  select avg(rating), count(*) into _avg_rating, _cnt from public.action_evaluations where event_id = _event_id;
  if _cnt is null or _cnt < 3 then
    -- not final yet
    return;
  end if;
  select c.xp_reward, e.eval_multiplier, coalesce(t.team_modifier,1)
    into _xp, _eval_multiplier, _team_mod
  from public.events e
  left join public.challenges c on c.id = e.challenge_id
  left join public.profiles p on p.id = e.user_id
  left join public.teams t on t.id = p.team_id
  where e.id = _event_id;

  if _xp is null then _xp := 0; end if;
  if _eval_multiplier is null then _eval_multiplier := 1; end if;
  update public.events
  set final_points = public.calculate_final_points(_xp, round((_avg_rating/5.0)::numeric, 2), _eval_multiplier, _team_mod),
      status = 'evaluated'
  where id = _event_id;
end;
$$;

