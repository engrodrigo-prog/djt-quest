-- Guardião da Vida: campaign evidences bypass evaluation and become auto-approved.
-- Also backfill existing campaign evidences already submitted/evaluated.

create or replace function public.is_guardiao_da_vida_campaign(_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    regexp_replace(
      lower(extensions.unaccent(coalesce(c.title, '') || ' ' || coalesce(c.narrative_tag, ''))),
      '[^a-z0-9]+',
      '',
      'g'
    ) like '%guardiaodavida%'
  from public.campaigns c
  where c.id = _campaign_id
$$;

create or replace function public.on_event_created_assign()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  campaign_uuid uuid;
  is_guardiao boolean := false;
begin
  -- Add the submitter as participant if none exists yet
  if not exists (select 1 from public.event_participants ep where ep.event_id = new.id) then
    insert into public.event_participants(event_id, user_id)
    values (new.id, new.user_id)
    on conflict do nothing;
  end if;

  -- Guardião da Vida: skip evaluation and auto-approve campaign evidences.
  if coalesce(new.payload->>'source', '') = 'campaign_evidence' then
    begin
      campaign_uuid := nullif(trim(coalesce(new.payload->>'campaign_id', '')), '')::uuid;
    exception when others then
      campaign_uuid := null;
    end;

    if campaign_uuid is not null then
      is_guardiao := public.is_guardiao_da_vida_campaign(campaign_uuid);
    end if;

    if is_guardiao then
      delete from public.evaluation_queue where event_id = new.id;
      delete from public.action_evaluations where event_id = new.id;

      update public.events
      set status = 'approved',
          awaiting_second_evaluation = false,
          first_evaluator_id = null,
          second_evaluator_id = null,
          first_evaluation_rating = null,
          second_evaluation_rating = null,
          assigned_evaluator_id = null,
          assignment_type = null
      where id = new.id;

      return new;
    end if;
  end if;

  perform public.assign_evaluators_for_event(new.id);
  return new;
end;
$$;

-- Backfill existing Guardião da Vida campaign evidences:
-- - remove evaluation queue rows
-- - remove action evaluations
-- - force status to approved (so it appears in campaign history)
do $$
declare
  updated_count int := 0;
  queue_deleted int := 0;
  evals_deleted int := 0;
begin
  with guardiao_campaigns as (
    select id, evidence_challenge_id
    from public.campaigns c
    where regexp_replace(
      lower(extensions.unaccent(coalesce(c.title, '') || ' ' || coalesce(c.narrative_tag, ''))),
      '[^a-z0-9]+',
      '',
      'g'
    ) like '%guardiaodavida%'
  ),
  guardiao_events as (
    select e.id
    from public.events e
    where coalesce(e.payload->>'source', '') = 'campaign_evidence'
      and exists (
        select 1
        from guardiao_campaigns gc
        where (gc.evidence_challenge_id is not null and e.challenge_id = gc.evidence_challenge_id)
           or (e.payload->>'campaign_id' = gc.id::text)
      )
  ),
  dq as (
    delete from public.evaluation_queue eq
    using guardiao_events ge
    where eq.event_id = ge.id
    returning 1
  ),
  de as (
    delete from public.action_evaluations ae
    using guardiao_events ge
    where ae.event_id = ge.id
    returning 1
  ),
  up as (
    update public.events e
    set status = 'approved',
        awaiting_second_evaluation = false,
        first_evaluator_id = null,
        second_evaluator_id = null,
        first_evaluation_rating = null,
        second_evaluation_rating = null,
        assigned_evaluator_id = null,
        assignment_type = null
    where e.id in (select id from guardiao_events)
    returning 1
  )
  select (select count(*) from up),
         (select count(*) from dq),
         (select count(*) from de)
    into updated_count, queue_deleted, evals_deleted;

  raise notice 'Guardião da Vida backfill: events approved=%, queue deleted=%, evals deleted=%', updated_count, queue_deleted, evals_deleted;
end $$;

