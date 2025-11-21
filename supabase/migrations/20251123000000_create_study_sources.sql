-- Study sources table required by StudyLab (catalog + chat context)

create table if not exists public.study_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text,
  kind text check (kind in ('text','url','file','youtube')),
  url text,
  storage_path text,
  summary text,
  is_persistent boolean default false,
  created_at timestamptz default now(),
  last_used_at timestamptz default now()
);

alter table public.study_sources enable row level security;

-- Basic owner read/write (adjust if you need broader access)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'study_sources' and policyname = 'StudySources owner read') then
    create policy "StudySources owner read" on public.study_sources
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'study_sources' and policyname = 'StudySources owner write') then
    create policy "StudySources owner write" on public.study_sources
      for all using (auth.uid() = user_id);
  end if;
end $$;
