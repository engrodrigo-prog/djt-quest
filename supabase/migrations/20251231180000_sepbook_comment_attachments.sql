-- Add attachments to SEPBook comments (photos in comments)

alter table if exists public.sepbook_comments
  add column if not exists attachments jsonb default '[]'::jsonb;

update public.sepbook_comments
  set attachments = '[]'::jsonb
  where attachments is null;
