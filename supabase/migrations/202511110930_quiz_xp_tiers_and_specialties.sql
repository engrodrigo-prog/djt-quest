-- Align quiz question difficulty and XP tiers, add specialties and CHAS dimension to challenges

-- 1) Normalizar valores antigos e só depois reforçar os constraints

-- Remover constraints antigos para liberar ajustes
alter table if exists public.quiz_questions
  drop constraint if exists quiz_questions_difficulty_level_check;

alter table if exists public.quiz_questions
  drop constraint if exists quiz_questions_xp_value_check;

-- Migrar valores legados de dificuldade
update public.quiz_questions
set difficulty_level = case difficulty_level
  when 'basica'        then 'basico'
  when 'intermediaria' then 'intermediario'
  else difficulty_level
end;

-- Ajustar xp_value para bater com a dificuldade
update public.quiz_questions
set xp_value = case difficulty_level
  when 'basico'        then 5
  when 'intermediario' then 10
  when 'avancado'      then 20
  when 'especialista'  then 40
  else xp_value
end;

-- Agora, com os dados já normalizados, recriar os checks
alter table if exists public.quiz_questions
  add constraint quiz_questions_difficulty_level_check
  check (difficulty_level in ('basico','intermediario','avancado','especialista'));

alter table if exists public.quiz_questions
  add constraint quiz_questions_xp_value_check
  check (xp_value in (5,10,20,40));

-- 2) Add specialties and CHAS dimension to challenges
alter table if exists public.challenges
  add column if not exists quiz_specialties text[];

alter table if exists public.challenges
  add column if not exists chas_dimension char(1)
  not null default 'C'
  check (chas_dimension in ('C','H','A','S'));

comment on column public.challenges.quiz_specialties is
  'Especialidades relacionadas ao quiz (seguranca, protecao_automacao, telecom, equipamentos_manobras, instrumentacao, gerais)';

comment on column public.challenges.chas_dimension is
  'Dimensão CHAS: C=Conhecimento, H=Habilidade, A=Atitude, S=Segurança';