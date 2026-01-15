-- Allow any evaluator to see their own evaluation queue entries,
-- and read the corresponding events required to perform the evaluation.

drop policy if exists "EvaluationQueue: assignee read" on public.evaluation_queue;
create policy "EvaluationQueue: assignee read" on public.evaluation_queue
  as permissive for select to authenticated
  using ((select auth.uid()) = assigned_to);

drop policy if exists "Events: evaluator read" on public.events;
create policy "Events: evaluator read" on public.events
  as permissive for select to authenticated
  using (
    exists (
      select 1
      from public.evaluation_queue eq
      where eq.event_id = events.id
        and eq.assigned_to = (select auth.uid())
    )
  );

