-- One-off operational fix: if Rodrigo Nascimento has a pending event requiring 2 evaluations
-- but fewer than 2 assignees in evaluation_queue, dispatch the missing evaluator now.

-- Avoid migration statement timeout (this is an operational query).
set statement_timeout = '120s';

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
    raise notice 'Dispatch: Rodrigo Nascimento profile not found; skipping.';
    return;
  end if;

  -- Find the most recent pending submission from Rodrigo that requires 2 evaluations,
  -- but has fewer than 2 pending assignees. Drive from evaluation_queue to avoid scanning events.
  select e.id
    into ev_id
  from public.evaluation_queue eq
  join public.events e on e.id = eq.event_id
  left join public.challenges c on c.id = e.challenge_id
  where eq.completed_at is null
    and e.user_id = rodrigo_id
    and e.status::text in ('submitted','awaiting_evaluation','awaiting_second_evaluation')
    and e.created_at > now() - interval '720 days'
    and (
      e.challenge_id is null
      or coalesce(c.require_two_leader_eval, false)
      or coalesce((e.payload->>'source') = 'campaign_evidence', false)
    )
  group by e.id, e.created_at
  having count(distinct eq.assigned_to) filter (where eq.assigned_to is not null and eq.completed_at is null) < 2
  order by e.created_at desc
  limit 1;

  if ev_id is null then
    raise notice 'Dispatch: no stuck pending event found for Rodrigo.';
    return;
  end if;

  select count(distinct assigned_to) into before_cnt
  from public.evaluation_queue
  where event_id = ev_id and completed_at is null and assigned_to is not null;

  perform public.assign_evaluators_for_event(ev_id);

  select count(distinct assigned_to) into after_cnt
  from public.evaluation_queue
  where event_id = ev_id and completed_at is null and assigned_to is not null;

  raise notice 'Dispatch: event %, assignees before=% after=%', ev_id, before_cnt, after_cnt;
end $$;

reset statement_timeout;
