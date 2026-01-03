-- Notify leaders when they receive an evaluation assignment (clears when read in UI; can also be marked read on completion by edge functions)

create or replace function public.notify_evaluation_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ch_title text;
  ch_id uuid;
begin
  if new.assigned_to is null then
    return new;
  end if;
  if new.completed_at is not null then
    return new;
  end if;

  select c.id, c.title
    into ch_id, ch_title
  from public.events e
  left join public.challenges c on c.id = e.challenge_id
  where e.id = new.event_id;

  perform public.create_notification(
    new.assigned_to,
    'evaluation_assigned',
    '📋 Nova avaliação pendente',
    case
      when ch_title is not null and length(trim(ch_title)) > 0 then 'Você tem uma nova avaliação pendente: ' || ch_title
      else 'Você tem uma nova avaliação pendente.'
    end,
    jsonb_build_object(
      'event_id', new.event_id,
      'evaluation_queue_id', new.id,
      'challenge_id', ch_id,
      'is_cross_evaluation', coalesce(new.is_cross_evaluation, false)
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_evaluation_assignment on public.evaluation_queue;
create trigger trg_notify_evaluation_assignment
after insert on public.evaluation_queue
for each row
execute function public.notify_evaluation_assignment();

