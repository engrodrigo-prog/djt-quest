-- Add reward configuration to challenges and per-attempt reward targeting for Milhão mode

alter table if exists public.challenges
  add column if not exists reward_mode text
  check (reward_mode in ('fixed_xp','tier_steps'));

alter table if exists public.challenges
  add column if not exists reward_tier_steps smallint
  check (reward_tier_steps between 1 and 5);

comment on column public.challenges.reward_mode is
  'Modo de recompensa: fixed_xp usa xp_reward; tier_steps calcula XP necessário para avançar N patamares.';

comment on column public.challenges.reward_tier_steps is
  'Quantidade de patamares (tiers) a avançar quando reward_mode=tier_steps.';

alter table if exists public.quiz_attempts
  add column if not exists reward_total_xp_target integer
  check (reward_total_xp_target >= 0);

comment on column public.quiz_attempts.reward_total_xp_target is
  'Alvo de XP total desta tentativa (usado para congelar escala quando reward_mode=tier_steps).';

-- Safety: prevent legacy Milhão quizzes from awarding excessive XP going forward (UI + backend use xp_reward as configured total).
update public.challenges
set xp_reward = 1000,
    reward_mode = coalesce(reward_mode, 'fixed_xp')
where (type = 'quiz')
  and title ilike 'Quiz do Milhão:%'
  and xp_reward > 5000;

