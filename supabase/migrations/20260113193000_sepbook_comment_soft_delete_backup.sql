-- SEPBook comments: preserve deleted content for restore.

alter table if exists public.sepbook_comments
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists deleted_backup jsonb;

create index if not exists idx_sepbook_comments_deleted_at
  on public.sepbook_comments (deleted_at)
  where deleted_at is not null;

