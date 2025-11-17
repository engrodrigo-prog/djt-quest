-- Histórico de bonificação mensal por coordenação
create table if not exists public.bonus_ranking_history (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  month integer not null,
  coord_id text not null references public.coordinations(id) on delete cascade,
  position integer not null check (position between 1 and 6),
  bonus_xp integer not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists uq_bonus_ranking_history
  on public.bonus_ranking_history(year, month, coord_id);

