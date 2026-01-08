-- Event participants: allow owners to write and enforce guest rules.

-- 1) Write policies (insert/update/delete) for event owners and staff.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'event_participants'
      and policyname = 'EventParticipants: owner insert'
  ) then
    create policy "EventParticipants: owner insert"
      on public.event_participants
      for insert
      to public
      with check (
        exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
        or public.is_staff((select auth.uid()))
      );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'event_participants'
      and policyname = 'EventParticipants: owner update'
  ) then
    create policy "EventParticipants: owner update"
      on public.event_participants
      for update
      to public
      using (
        exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
        or public.is_staff((select auth.uid()))
      )
      with check (
        exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
        or public.is_staff((select auth.uid()))
      );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'event_participants'
      and policyname = 'EventParticipants: owner delete'
  ) then
    create policy "EventParticipants: owner delete"
      on public.event_participants
      for delete
      to public
      using (
        exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
        or public.is_staff((select auth.uid()))
      );
  end if;
end $$;

-- 2) Read policy for staff (owners already have the "owner read" policy in older migrations).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'event_participants'
      and policyname = 'EventParticipants: staff read'
  ) then
    create policy "EventParticipants: staff read"
      on public.event_participants
      for select
      to public
      using (public.is_staff((select auth.uid())));
  end if;
end $$;

-- 3) Helper to detect guests (invited role OR CONVIDADOS team markers).
create or replace function public.is_guest_user(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.user_roles ur where ur.user_id = u and ur.role::text = 'invited')
    or exists (
      select 1
      from public.profiles p
      where p.id = u
        and (
          upper(coalesce(p.team_id, '')) = 'CONVIDADOS'
          or upper(coalesce(p.sigla_area, '')) = 'CONVIDADOS'
          or upper(coalesce(p.operational_base, '')) = 'CONVIDADOS'
        )
    );
$$;

-- 4) Enforce guest rules at DB level:
--    - Guest author: can only have self as participant.
--    - Non-guest author: cannot add guest participants.
create or replace function public.enforce_event_participants_guest_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_id uuid;
  author_is_guest boolean;
  participant_is_guest boolean;
begin
  select user_id into author_id from public.events where id = new.event_id;
  if author_id is null then
    return new;
  end if;

  author_is_guest := public.is_guest_user(author_id);
  participant_is_guest := public.is_guest_user(new.user_id);

  if author_is_guest then
    if new.user_id <> author_id then
      raise exception 'Convidado não pode marcar outros participantes';
    end if;
  else
    if participant_is_guest then
      raise exception 'Convidado não pode ser marcado como participante';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_event_participants_guest_rules on public.event_participants;
create trigger trg_event_participants_guest_rules
before insert or update on public.event_participants
for each row execute function public.enforce_event_participants_guest_rules();

