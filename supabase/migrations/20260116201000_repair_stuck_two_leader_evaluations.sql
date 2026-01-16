-- Repair: events stuck in awaiting_second_evaluation with 2 completed evaluators but 0 action_evaluations.
-- Root cause: past schema mismatch (rating scale constraint) prevented inserts.
-- This migration reconstructs the two evaluation rows (from evaluation_queue + evaluation_partial notifications),
-- finalizes the event, and applies XP once (guarded by points_calculated = 0).

do $$
declare
  ev record;
  q1 record;
  q2 record;
  name1 text;
  name2 text;
  r1 numeric;
  r2 numeric;
  avg_rating numeric;
  quality numeric;
  base_xp integer;
  eval_mult numeric;
  team_mod numeric;
  retry_count integer;
  final_xp integer;
  reviewer_level_1 reviewer_level;
  reviewer_level_2 reviewer_level;
  placeholder_feedback text := 'Avaliação recuperada automaticamente (registro original indisponível).';
begin
  for ev in
    select
      e.id as event_id,
      e.user_id as submitter_id,
      e.challenge_id,
      coalesce(e.retry_count, 0) as retry_count,
      coalesce(e.eval_multiplier, 1) as eval_multiplier,
      e.team_modifier_applied,
      coalesce(e.points_calculated, 0) as points_calculated,
      e.status,
      coalesce(e.awaiting_second_evaluation, false) as awaiting_second_evaluation
    from public.events e
    where e.status = 'awaiting_second_evaluation'
      and coalesce(e.awaiting_second_evaluation, false) = true
      and coalesce(e.points_calculated, 0) = 0
      and not exists (select 1 from public.action_evaluations ae where ae.event_id = e.id)
      and (select count(*) from public.evaluation_queue q where q.event_id = e.id and q.completed_at is not null) >= 2
  loop
    -- Pick the two completed assignments (prefer immediate leader first: is_cross_evaluation=false).
    select q.id, q.assigned_to, q.is_cross_evaluation, q.completed_at
      into q1
    from public.evaluation_queue q
    where q.event_id = ev.event_id and q.completed_at is not null
    order by coalesce(q.is_cross_evaluation, false) asc, q.completed_at asc
    limit 1 offset 0;

    select q.id, q.assigned_to, q.is_cross_evaluation, q.completed_at
      into q2
    from public.evaluation_queue q
    where q.event_id = ev.event_id and q.completed_at is not null
    order by coalesce(q.is_cross_evaluation, false) asc, q.completed_at asc
    limit 1 offset 1;

    if q1.assigned_to is null or q2.assigned_to is null then
      continue;
    end if;

    select p.name into name1 from public.profiles p where p.id = q1.assigned_to;
    select p.name into name2 from public.profiles p where p.id = q2.assigned_to;

    -- Try to map ratings from the submitter's evaluation_partial notifications.
    select (n.metadata->>'rating')::numeric
      into r1
    from public.notifications n
    where n.user_id = ev.submitter_id
      and n.type = 'evaluation_partial'
      and (n.metadata->>'event_id') = ev.event_id::text
      and (n.metadata->>'reviewer_name') = coalesce(name1, '')
    order by n.created_at desc
    limit 1;

    select (n.metadata->>'rating')::numeric
      into r2
    from public.notifications n
    where n.user_id = ev.submitter_id
      and n.type = 'evaluation_partial'
      and (n.metadata->>'event_id') = ev.event_id::text
      and (n.metadata->>'reviewer_name') = coalesce(name2, '')
    order by n.created_at desc
    limit 1;

    -- Fallback: use the newest two evaluation_partial ratings (by created_at).
    if r1 is null or r2 is null then
      select (n.metadata->>'rating')::numeric
        into r1
      from public.notifications n
      where n.user_id = ev.submitter_id
        and n.type = 'evaluation_partial'
        and (n.metadata->>'event_id') = ev.event_id::text
      order by n.created_at asc
      limit 1 offset 0;

      select (n.metadata->>'rating')::numeric
        into r2
      from public.notifications n
      where n.user_id = ev.submitter_id
        and n.type = 'evaluation_partial'
        and (n.metadata->>'event_id') = ev.event_id::text
      order by n.created_at asc
      limit 1 offset 1;
    end if;

    if r1 is null or r2 is null then
      continue;
    end if;

    -- reviewer_level: coordinators => coordenacao, otherwise divisao
    reviewer_level_1 :=
      case when exists (select 1 from public.user_roles ur where ur.user_id = q1.assigned_to and ur.role = 'coordenador_djtx')
        then 'coordenacao'::reviewer_level
        else 'divisao'::reviewer_level
      end;
    reviewer_level_2 :=
      case when exists (select 1 from public.user_roles ur where ur.user_id = q2.assigned_to and ur.role = 'coordenador_djtx')
        then 'coordenacao'::reviewer_level
        else 'divisao'::reviewer_level
      end;

    -- Recreate the two evaluation rows (minimal, but valid)
    insert into public.action_evaluations(
      event_id, reviewer_id, reviewer_level, scores, rating, feedback_positivo, feedback_construtivo, evaluation_number, final_rating
    ) values (
      ev.event_id, q1.assigned_to, reviewer_level_1, '{}'::jsonb, r1, placeholder_feedback, '', 1, null
    ) on conflict (event_id, reviewer_id) do nothing;

    insert into public.action_evaluations(
      event_id, reviewer_id, reviewer_level, scores, rating, feedback_positivo, feedback_construtivo, evaluation_number, final_rating
    ) values (
      ev.event_id, q2.assigned_to, reviewer_level_2, '{}'::jsonb, r2, placeholder_feedback, '', 2, null
    ) on conflict (event_id, reviewer_id) do nothing;

    avg_rating := (r1 + r2) / 2.0;
    quality := greatest(0, least(1, avg_rating / 10.0));

    select coalesce(c.xp_reward, 0)
      into base_xp
    from public.challenges c
    where c.id = ev.challenge_id;

    eval_mult := coalesce(ev.eval_multiplier, 1);
    retry_count := coalesce(ev.retry_count, 0);

    select coalesce(ev.team_modifier_applied, t.team_modifier, 1)
      into team_mod
    from public.events e
    join public.profiles p on p.id = e.user_id
    left join public.teams t on t.id = p.team_id
    where e.id = ev.event_id;

    final_xp := public.calculate_final_points(base_xp, quality, eval_mult, team_mod, retry_count);

    update public.events
       set status = 'approved',
           awaiting_second_evaluation = false,
           first_evaluator_id = q1.assigned_to,
           first_evaluation_rating = r1,
           second_evaluator_id = q2.assigned_to,
           second_evaluation_rating = r2,
           quality_score = quality,
           final_points = final_xp,
           points_calculated = final_xp,
           updated_at = now()
     where id = ev.event_id
       and coalesce(points_calculated, 0) = 0;

    -- Apply XP exactly once (guarded above)
    if final_xp is not null and final_xp <> 0 then
      perform public.increment_user_xp(ev.submitter_id, final_xp::int);
    end if;

    -- Best-effort: notify submitter of completion (if not already)
    begin
      perform public.create_notification(
        ev.submitter_id,
        'evaluation_complete',
        '✅ Ação Aprovada!',
        'Sua ação foi aprovada! O sistema recuperou as avaliações e aplicou o XP.',
        jsonb_build_object(
          'event_id', ev.event_id,
          'first_rating', r1,
          'second_rating', r2,
          'average_rating', avg_rating,
          'xp_earned', final_xp
        )
      );
    exception when others then
      null;
    end;
  end loop;
end $$;

