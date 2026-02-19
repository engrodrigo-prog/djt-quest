-- Guardião da Vida: store number of impacted people per campaign evidence/action (optional for other campaigns).
-- Idempotent: safe to run multiple times.

alter table public.events
  add column if not exists people_impacted integer check (people_impacted >= 0);

