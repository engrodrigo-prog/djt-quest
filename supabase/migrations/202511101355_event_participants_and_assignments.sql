-- Map participants per event
create table if not exists public.event_participants (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (event_id, user_id)
);

alter table public.event_participants enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='event_participants' and policyname='EventParticipants: owner read') then
    create policy "EventParticipants: owner read" on public.event_participants for select using (
      exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
    );
  end if;
end $$;

-- Ensure at least 1 and at most 20 participants per event
create or replace function public.enforce_participants_count()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  cnt int;
begin
  select count(*) into cnt from public.event_participants where event_id = new.event_id;
  if cnt < 1 or cnt > 20 then
    raise exception 'Cada ação deve ter entre 1 e 20 participantes (atual: %)', cnt;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_participants on public.event_participants;
create trigger trg_enforce_participants
after insert or delete on public.event_participants
for each row execute function public.enforce_participants_count();

-- Fair assignment: pick 2 leaders with least pending and oldest last assignment
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

  -- immediate leader: same team leader if exists, else same coord/ division leader
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

  -- fair pick for another leader (not manager), excluding immediate
  with candidates as (
    select ur.user_id,
           coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = ur.user_id and eq.completed_at is null),0) as pending,
           coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = ur.user_id), to_timestamp(0)) as last_assigned
    from public.user_roles ur
    where ur.role in ('coordenador_djtx','gerente_divisao_djtx')
      and ur.user_id <> coalesce(c_immediate, '00000000-0000-0000-0000-000000000000')::uuid
      and ur.user_id <> _submitter
  )
  select user_id into c_leader from candidates order by pending asc, last_assigned asc, random() limit 1;

  -- fair pick for a manager (gerente_djt)
  with mg as (
    select ur.user_id,
           coalesce((select count(*) from public.evaluation_queue eq where eq.assigned_to = ur.user_id and eq.completed_at is null),0) as pending,
           coalesce((select max(assigned_at) from public.evaluation_queue eq2 where eq2.assigned_to = ur.user_id), to_timestamp(0)) as last_assigned
    from public.user_roles ur
    where ur.role = 'gerente_djt' and ur.user_id <> _submitter
  )
  select user_id into c_manager from mg order by pending asc, last_assigned asc, random() limit 1;

  -- Insert assignments (ignore duplicates/nulls)
  if c_immediate is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at)
    values (_event_id, c_immediate, now()) on conflict (event_id) do nothing;
  end if;
  if c_leader is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at)
    values (_event_id, c_leader, now()) on conflict (event_id) do nothing;
  end if;
  if c_manager is not null then
    insert into public.evaluation_queue(event_id, assigned_to, assigned_at)
    values (_event_id, c_manager, now()) on conflict (event_id) do nothing;
  end if;
end;
$$;

-- When an event is created/submitted, ensure it has at least one participant and assign evaluators
create or replace function public.on_event_created_assign()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  -- Add the submitter as participant if none exists yet
  if not exists (select 1 from public.event_participants ep where ep.event_id = new.id) then
    insert into public.event_participants(event_id, user_id) values (new.id, new.user_id) on conflict do nothing;
  end if;
  perform public.assign_evaluators_for_event(new.id);
  return new;
end;
$$;

drop trigger if exists trg_event_created_assign on public.events;
create trigger trg_event_created_assign
after insert on public.events
for each row execute function public.on_event_created_assign();
