-- Track ingest/curadoria status for StudyLab sources
alter table if exists public.study_sources
  add column if not exists ingest_status text default 'pending',
  add column if not exists ingested_at timestamptz,
  add column if not exists ingest_error text;

-- Optional: backfill existing rows as ok if already have full_text or summary
update public.study_sources
set ingest_status = 'ok',
    ingested_at = coalesce(last_used_at, created_at)
where (full_text is not null and length(full_text) > 0)
   or  (summary is not null and length(summary) > 0)
   or ingest_status is null;

