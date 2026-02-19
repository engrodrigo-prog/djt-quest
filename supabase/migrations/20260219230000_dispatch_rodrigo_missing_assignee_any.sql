-- One-off operational fix: dispatch missing evaluator(s) for Rodrigo Nascimento submissions.
-- This migration is intentionally driven from evaluation_queue to avoid scanning events.

do $$
declare
  rodrigo_id uuid;
  ev_id uuid;
  before_cnt int := 0;
  after_cnt int := 0;
begin
  select p.id into rodrigo_id
  from public.profiles p
  where lower(coalesce(p.email,'')) = 'rodrigonasc@cpfl.com.br'
     or p.name ilike 'rodrigo% nascimento%'
  order by (lower(coalesce(p.email,'')) = 'rodrigonasc@cpfl.com.br') desc, p.id
  limit 1;

  if rodrigo_id is null then
    raise notice 'Dispatch (any): Rodrigo profile not found; skipping.';
    return;
  end if;

  with candidates as (
    select
      e.id as event_id,
      e.created_at,
      (
        e.challenge_id is null
        or coalesce(c.require_two_leader_eval, false)
        or coalesce((e.payload->>'source') = 'campaign_evidence', false)
      ) as requires_two,
      count(distinct eq.assigned_to) filter (where eq.assigned_to is not null and eq.completed_at is null) as assignees
    from public.evaluation_queue eq
    join public.events e on e.id = eq.event_id
    left join public.challenges c on c.id = e.challenge_id
    where eq.completed_at is null
      and e.user_id = rodrigo_id
      and e.status::text in (
        'submitted',
        'awaiting_evaluation',
        'awaiting_second_evaluation',
        'retry_pending',
        'retry_in_progress'
      )
      and e.created_at > now() - interval '900 days'
    group by e.id, e.created_at, e.challenge_id, c.require_two_leader_eval, (e.payload->>'source')
  )
  select event_id
    into ev_id
  from candidates
  where assignees < (case when requires_two then 2 else 1 end)
  order by created_at desc
  limit 1;

  if ev_id is null then
    raise notice 'Dispatch (any): no stuck event found for Rodrigo in evaluation_queue.';
    return;
  end if;

  select count(distinct assigned_to) into before_cnt
  from public.evaluation_queue
  where event_id = ev_id and completed_at is null and assigned_to is not null;

  perform public.assign_evaluators_for_event(ev_id);

  select count(distinct assigned_to) into after_cnt
  from public.evaluation_queue
  where event_id = ev_id and completed_at is null and assigned_to is not null;

  raise notice 'Dispatch (any): event %, assignees before=% after=%', ev_id, before_cnt, after_cnt;
end $$;

