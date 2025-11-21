-- Add full_text column to study_sources if missing

alter table if exists public.study_sources
  add column if not exists full_text text;

