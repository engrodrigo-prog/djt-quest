-- Fix lint: remove SECURITY DEFINER behavior from views by enabling security_invoker
alter view if exists public.team_campaign_performance set (security_invoker = true);
alter view if exists public.team_xp_summary set (security_invoker = true);
alter view if exists public.team_challenge_performance set (security_invoker = true);
alter view if exists public.forum_knowledge_base set (security_invoker = true);

-- Enable RLS on public tables flagged by lint and add permissive read policies to preserve current behavior.
do $$
begin
  -- Helper: enable RLS and ensure a basic SELECT policy that allows reads
  -- without breaking existing service role usage. Service role bypasses RLS.
  perform 1;
end $$;

alter table if exists public.sepbook_xp_log enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sepbook_xp_log' and policyname = 'sepbook_xp_log_select_all'
  ) then
    create policy "sepbook_xp_log_select_all" on public.sepbook_xp_log
      for select using (true);
  end if;
end $$;

alter table if exists public.bonus_ranking_history enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bonus_ranking_history' and policyname = 'bonus_ranking_history_select_all'
  ) then
    create policy "bonus_ranking_history_select_all" on public.bonus_ranking_history
      for select using (true);
  end if;
end $$;

alter table if exists public.sepbook_likes enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sepbook_likes' and policyname = 'sepbook_likes_select_all'
  ) then
    create policy "sepbook_likes_select_all" on public.sepbook_likes
      for select using (true);
  end if;
end $$;

alter table if exists public.sepbook_comments enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sepbook_comments' and policyname = 'sepbook_comments_select_all'
  ) then
    create policy "sepbook_comments_select_all" on public.sepbook_comments
      for select using (true);
  end if;
end $$;

alter table if exists public.sepbook_posts enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sepbook_posts' and policyname = 'sepbook_posts_select_all'
  ) then
    create policy "sepbook_posts_select_all" on public.sepbook_posts
      for select using (true);
  end if;
end $$;

alter table if exists public.sepbook_mentions enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sepbook_mentions' and policyname = 'sepbook_mentions_select_all'
  ) then
    create policy "sepbook_mentions_select_all" on public.sepbook_mentions
      for select using (true);
  end if;
end $$;

alter table if exists public.sepbook_last_seen enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sepbook_last_seen' and policyname = 'sepbook_last_seen_select_all'
  ) then
    create policy "sepbook_last_seen_select_all" on public.sepbook_last_seen
      for select using (true);
  end if;
end $$;

alter table if exists public.division_managers enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'division_managers' and policyname = 'division_managers_select_all'
  ) then
    create policy "division_managers_select_all" on public.division_managers
      for select using (true);
  end if;
end $$;

alter table if exists public.sepbook_post_participants enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sepbook_post_participants' and policyname = 'sepbook_post_participants_select_all'
  ) then
    create policy "sepbook_post_participants_select_all" on public.sepbook_post_participants
      for select using (true);
  end if;
end $$;

-- Departments: RLS habilitado mas sem policy -> adiciona policy de leitura ampla
alter table if exists public.departments enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'departments' and policyname = 'departments_select_all'
  ) then
    create policy "departments_select_all" on public.departments
      for select using (true);
  end if;
end $$;
