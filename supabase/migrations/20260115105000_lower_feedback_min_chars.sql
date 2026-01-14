-- Lower feedback minimum length on action_evaluations
alter table public.action_evaluations
  drop constraint if exists feedback_required;

alter table public.action_evaluations
  add constraint feedback_required check (
    length(coalesce(feedback_positivo, '')) >= 10
    or length(coalesce(feedback_construtivo, '')) >= 10
  );

