-- Align action_evaluations.rating with the 0..10 scale used by the app (2-leader evaluation UI).

alter table public.action_evaluations
  alter column rating type numeric(4,1)
  using rating::numeric;

alter table public.action_evaluations
  drop constraint if exists action_evaluations_rating_check;

alter table public.action_evaluations
  add constraint action_evaluations_rating_check
  check (rating >= 0.0 and rating <= 10.0);

