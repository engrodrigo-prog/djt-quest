-- Quiz attempts to enforce one attempt per user per quiz and enable analytics
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score integer not null default 0,
  max_score integer not null default 0,
  unique(user_id, challenge_id)
);

alter table public.quiz_attempts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quiz_attempts' and policyname='QuizAttempts: own select') then
    create policy "QuizAttempts: own select" on public.quiz_attempts for select using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quiz_attempts' and policyname='QuizAttempts: own insert') then
    create policy "QuizAttempts: own insert" on public.quiz_attempts for insert with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quiz_attempts' and policyname='QuizAttempts: own update') then
    create policy "QuizAttempts: own update" on public.quiz_attempts for update using ((select auth.uid()) = user_id);
  end if;
end $$;

comment on table public.quiz_attempts is 'One attempt per user per quiz (challenge) with simple scoring.';

