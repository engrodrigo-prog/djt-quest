-- Align quiz XP tiers with product spec (5,10,20,50)

alter table if exists public.quiz_questions
  drop constraint if exists quiz_questions_xp_value_check;

update public.quiz_questions
set xp_value = 50
where difficulty_level = 'especialista' or xp_value = 40;

alter table if exists public.quiz_questions
  add constraint quiz_questions_xp_value_check
  check (xp_value in (5,10,20,50));

