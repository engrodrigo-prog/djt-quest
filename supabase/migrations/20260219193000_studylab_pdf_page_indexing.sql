-- StudyLab: index PDF pages for in-document search + page references

-- 1) Store page number alongside embeddings (optional; null for non-PDF chunks)
alter table if exists public.study_source_chunks
  add column if not exists page_number integer;

create index if not exists idx_study_source_chunks_source_page
  on public.study_source_chunks (source_id, page_number);

-- 2) Store per-page extracted text for keyword search + page guidance
create table if not exists public.study_source_pages (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.study_sources(id) on delete cascade,
  page_number integer not null,
  content text not null,
  content_tsv tsvector generated always as (to_tsvector('simple', coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  unique (source_id, page_number)
);

create index if not exists idx_study_source_pages_source_id
  on public.study_source_pages (source_id);

create index if not exists idx_study_source_pages_tsv
  on public.study_source_pages
  using gin (content_tsv);

alter table public.study_source_pages enable row level security;

drop policy if exists "StudySourcePages: read public or own" on public.study_source_pages;
create policy "StudySourcePages: read public or own"
on public.study_source_pages
for select
to authenticated
using (
  exists (
    select 1
    from public.study_sources ss
    where ss.id = source_id
      and (
        ss.user_id = (select auth.uid())
        or (ss.scope = 'org' and ss.published = true)
      )
  )
);

-- 3) Server-side helper: semantic search constrained to allowed source ids.
--    This avoids leaking chunks when the server uses the service role key.
create or replace function public.match_study_source_chunks_scoped(
  query_embedding vector(1536),
  allowed_source_ids uuid[],
  match_count integer default 8,
  match_threshold double precision default 0.0
)
returns table (
  source_id uuid,
  source_title text,
  source_url text,
  source_storage_path text,
  source_summary text,
  chunk_content text,
  page_number integer,
  similarity double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.source_id,
    ss.title as source_title,
    ss.url as source_url,
    ss.storage_path as source_storage_path,
    ss.summary as source_summary,
    c.content as chunk_content,
    c.page_number,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.study_source_chunks c
  join public.study_sources ss on ss.id = c.source_id
  where c.source_id = any(allowed_source_ids)
    and (1 - (c.embedding <=> query_embedding)) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_study_source_chunks_scoped(vector(1536), uuid[], integer, double precision) from public;
grant execute on function public.match_study_source_chunks_scoped(vector(1536), uuid[], integer, double precision) to service_role;

-- 4) Server-side helper: keyword search constrained to allowed source ids.
create or replace function public.search_study_source_pages_scoped(
  query_text text,
  allowed_source_ids uuid[],
  match_count integer default 8
)
returns table (
  source_id uuid,
  source_title text,
  source_url text,
  source_storage_path text,
  source_summary text,
  page_number integer,
  page_snippet text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('simple', left(coalesce(query_text, ''), 512)) as tsq
  )
  select
    p.source_id,
    ss.title as source_title,
    ss.url as source_url,
    ss.storage_path as source_storage_path,
    ss.summary as source_summary,
    p.page_number,
    ts_headline('simple', p.content, q.tsq, 'MaxWords=35,MinWords=10,ShortWord=3,MaxFragments=2,FragmentDelimiter= … ') as page_snippet,
    ts_rank_cd(p.content_tsv, q.tsq) as rank
  from public.study_source_pages p
  join public.study_sources ss on ss.id = p.source_id
  cross join q
  where p.source_id = any(allowed_source_ids)
    and q.tsq is not null
    and p.content_tsv @@ q.tsq
  order by rank desc
  limit match_count;
$$;

revoke all on function public.search_study_source_pages_scoped(text, uuid[], integer) from public;
grant execute on function public.search_study_source_pages_scoped(text, uuid[], integer) to service_role;

-- 5) Client-safe helper (RLS applies): search pages the caller can read.
create or replace function public.search_study_source_pages(
  query_text text,
  match_count integer default 8
)
returns table (
  source_id uuid,
  source_title text,
  source_url text,
  source_storage_path text,
  source_summary text,
  page_number integer,
  page_snippet text,
  rank real
)
language sql
stable
as $$
  with q as (
    select websearch_to_tsquery('simple', left(coalesce(query_text, ''), 512)) as tsq
  )
  select
    p.source_id,
    ss.title as source_title,
    ss.url as source_url,
    ss.storage_path as source_storage_path,
    ss.summary as source_summary,
    p.page_number,
    ts_headline('simple', p.content, q.tsq, 'MaxWords=35,MinWords=10,ShortWord=3,MaxFragments=2,FragmentDelimiter= … ') as page_snippet,
    ts_rank_cd(p.content_tsv, q.tsq) as rank
  from public.study_source_pages p
  join public.study_sources ss on ss.id = p.source_id
  cross join q
  where q.tsq is not null
    and p.content_tsv @@ q.tsq
  order by rank desc
  limit match_count;
$$;

grant execute on function public.search_study_source_pages(text, integer) to authenticated;
