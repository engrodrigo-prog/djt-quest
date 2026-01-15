-- Evaluations: do not create generic notifications for evaluation assignments.
-- Pending evaluations are surfaced via dedicated badges (evaluation_queue / leadership assignments).

drop trigger if exists trg_notify_evaluation_assignment on public.evaluation_queue;

-- Best-effort cleanup: avoid "stuck" unread notifications created by the old trigger.
update public.notifications
set read = true,
    read_at = now()
where type = 'evaluation_assigned'
  and coalesce(read, false) = false;

