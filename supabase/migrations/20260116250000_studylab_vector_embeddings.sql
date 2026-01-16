-- StudyLab: semantic retrieval (pgvector) for catalog materials

create extension if not exists vector;

create table if not exists public.study_source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.study_sources(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_study_source_chunks_source_id
  on public.study_source_chunks (source_id);

-- Vector index (cosine distance). Safe even for small datasets.
create index if not exists idx_study_source_chunks_embedding_cosine
  on public.study_source_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.study_source_chunks enable row level security;

drop policy if exists "StudySourceChunks: read public or own" on public.study_source_chunks;
create policy "StudySourceChunks: read public or own"
on public.study_source_chunks
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

-- RPC helper used by server-side StudyLab oracle mode (RLS applies).
create or replace function public.match_study_source_chunks(
  query_embedding vector(1536),
  match_count integer default 8,
  match_threshold double precision default 0.0
)
returns table (
  source_id uuid,
  source_title text,
  source_url text,
  source_summary text,
  chunk_content text,
  similarity double precision
)
language sql
stable
as $$
  select
    c.source_id,
    ss.title as source_title,
    ss.url as source_url,
    ss.summary as source_summary,
    c.content as chunk_content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.study_source_chunks c
  join public.study_sources ss on ss.id = c.source_id
  where (1 - (c.embedding <=> query_embedding)) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_study_source_chunks(vector(1536), integer, double precision) to authenticated, service_role;

