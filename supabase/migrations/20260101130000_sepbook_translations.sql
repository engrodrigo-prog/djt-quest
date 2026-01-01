-- Add translations map to SEPBook content (posts/comments)
-- Stores per-locale text for: pt-BR, en, zh-CN

alter table if exists public.sepbook_posts
  add column if not exists translations jsonb default '{}'::jsonb;

alter table if exists public.sepbook_comments
  add column if not exists translations jsonb default '{}'::jsonb;

update public.sepbook_posts
  set translations = '{}'::jsonb
  where translations is null;

update public.sepbook_comments
  set translations = '{}'::jsonb
  where translations is null;

