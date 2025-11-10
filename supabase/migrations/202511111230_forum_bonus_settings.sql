-- Settings and monthly forum bonus awards
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb
);

alter table public.system_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='SystemSettings: read' and tablename='system_settings') then
    create policy "SystemSettings: read" on public.system_settings for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='SystemSettings: leaders upsert' and tablename='system_settings') then
    create policy "SystemSettings: leaders upsert" on public.system_settings for all using (
      public.has_role((select auth.uid()), 'coordenador_djtx') or
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') or
      public.has_role((select auth.uid()), 'gerente_djt') or
      public.has_role((select auth.uid()), 'admin')
    ) with check (
      public.has_role((select auth.uid()), 'coordenador_djtx') or
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') or
      public.has_role((select auth.uid()), 'gerente_djt') or
      public.has_role((select auth.uid()), 'admin')
    );
  end if;
end $$;

create table if not exists public.forum_monthly_bonus_awards (
  month text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bonus_pct numeric not null,
  base_xp int not null default 0,
  bonus_xp int not null default 0,
  applied_at timestamptz not null default now(),
  primary key(month, user_id)
);

alter table public.forum_monthly_bonus_awards enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='ForumBonusAwards: read' and tablename='forum_monthly_bonus_awards') then
    create policy "ForumBonusAwards: read" on public.forum_monthly_bonus_awards for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumBonusAwards: leaders insert' and tablename='forum_monthly_bonus_awards') then
    create policy "ForumBonusAwards: leaders insert" on public.forum_monthly_bonus_awards for insert with check (
      public.has_role((select auth.uid()), 'coordenador_djtx') or
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') or
      public.has_role((select auth.uid()), 'gerente_djt') or
      public.has_role((select auth.uid()), 'admin')
    );
  end if;
end $$;

