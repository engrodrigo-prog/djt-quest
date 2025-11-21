-- Add topic/category classification to study_sources

alter table if exists public.study_sources
  add column if not exists topic text;

