-- Minimal schema to support challenges/campaigns and quiz tables if missing

-- challenge_type enum (idempotent)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'challenge_type') then
    create type public.challenge_type as enum ('quiz','mentoria','atitude','inspecao','forum');
  end if;
end$$;

-- campaigns
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  narrative_tag text,
  start_date date,
  end_date date,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- challenges
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type public.challenge_type not null default 'quiz',
  xp_reward integer default 0,
  campaign_id uuid references public.campaigns(id),
  require_two_leader_eval boolean default false,
  evidence_required boolean default false,
  target_team_ids uuid[],
  target_coord_ids uuid[],
  target_div_ids uuid[],
  target_dept_ids uuid[],
  created_at timestamptz default now()
);

-- quiz tables
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  question_text text not null,
  difficulty_level text not null check (difficulty_level in ('basica','intermediaria','avancada','especialista')),
  xp_value integer not null check (xp_value in (10,20,30,50)),
  order_index integer not null default 0,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  explanation text,
  created_at timestamptz default now()
);

create table if not exists public.user_quiz_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  challenge_id uuid not null references public.challenges(id),
  question_id uuid not null references public.quiz_questions(id),
  selected_option_id uuid not null references public.quiz_options(id),
  is_correct boolean not null,
  xp_earned integer not null default 0,
  answered_at timestamptz default now(),
  unique(user_id, question_id)
);

alter table public.quiz_questions enable row level security;
alter table public.quiz_options enable row level security;
alter table public.user_quiz_answers enable row level security;

