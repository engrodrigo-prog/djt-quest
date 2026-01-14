-- Reassign pending evaluations so immediate leader goes first (best-effort).
do $$
begin
  with pending_events as (
    select e.id as event_id,
           e.user_id,
           p.team_id
      from public.events e
      join public.profiles p on p.id = e.user_id
     where not exists (select 1 from public.action_evaluations ae where ae.event_id = e.id)
  ),
  immediate_leaders as (
    select pe.event_id,
           l.id as leader_id
      from pending_events pe
      join public.profiles l
        on l.is_leader = true
       and l.team_id = pe.team_id
       and l.id <> pe.user_id
  )
  delete from public.evaluation_queue eq
   using immediate_leaders il
   where eq.event_id = il.event_id
     and eq.assigned_to is not null
     and eq.assigned_to <> il.leader_id
     and eq.completed_at is null;

  insert into public.evaluation_queue(event_id, assigned_to, assigned_at, is_cross_evaluation)
  select il.event_id, il.leader_id, now(), false
    from immediate_leaders il
    left join public.evaluation_queue eq
      on eq.event_id = il.event_id
     and eq.assigned_to = il.leader_id
   where eq.event_id is null;
exception
  when undefined_table then
    -- Skip if schema is incomplete.
    null;
end $$;

