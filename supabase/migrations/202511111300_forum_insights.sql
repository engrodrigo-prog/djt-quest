-- Aggregated forum insights cache (top themes and proposed actions)
create table if not exists public.forum_insights (
  id uuid primary key default gen_random_uuid(),
  scope text not null, -- e.g., '2025-11' or 'last-90-days'
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id) on delete set null,
  items jsonb not null -- array of insight objects
);

alter table public.forum_insights enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='ForumInsights: read all' and tablename='forum_insights') then
    create policy "ForumInsights: read all" on public.forum_insights for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumInsights: leaders insert' and tablename='forum_insights') then
    create policy "ForumInsights: leaders insert" on public.forum_insights for insert with check (
      public.has_role((select auth.uid()), 'coordenador_djtx') or
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') or
      public.has_role((select auth.uid()), 'gerente_djt') or
      public.has_role((select auth.uid()), 'admin')
    );
  end if;
end $$;

