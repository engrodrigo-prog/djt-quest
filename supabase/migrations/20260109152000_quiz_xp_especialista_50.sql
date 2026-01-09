-- Allow specialist tier 50 without breaking legacy 40 rows (5,10,20,40,50)

alter table if exists public.quiz_questions
  drop constraint if exists quiz_questions_xp_value_check;

alter table if exists public.quiz_questions
  add constraint quiz_questions_xp_value_check
  check (xp_value in (5,10,20,40,50));
