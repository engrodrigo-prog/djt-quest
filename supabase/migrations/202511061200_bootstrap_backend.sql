-- Bootstrap backend schema for DJT Quest
-- Safe/idempotent-ish: uses IF NOT EXISTS where possible

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- Types
do $$ begin
  if not exists (select 1 from pg_type where typname = 'registration_status') then
    create type registration_status as enum ('pending','approved','rejected');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'password_reset_status') then
    create type password_reset_status as enum ('pending','approved','rejected');
  end if;
end $$;

-- Org hierarchy
create table if not exists public.divisions (
  id text primary key,
  name text not null
);

create table if not exists public.coordinations (
  id text primary key,
  division_id text references public.divisions(id) on delete set null,
  name text not null
);

create table if not exists public.teams (
  id text primary key,
  coord_id text references public.coordinations(id) on delete set null,
  name text not null
);

-- Profiles (one row per auth user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  email text unique,
  name text,
  xp integer not null default 0,
  tier text not null default 'novato',
  demotion_cooldown_until timestamptz,
  matricula text,
  sigla_area text,
  operational_base text,
  division_id text references public.divisions(id) on delete set null,
  coord_id text references public.coordinations(id) on delete set null,
  team_id text references public.teams(id) on delete set null,
  is_leader boolean not null default false,
  studio_access boolean not null default false,
  must_change_password boolean not null default false,
  needs_profile_completion boolean not null default false,
  date_of_birth date,
  avatar_url text,
  avatar_thumbnail_url text,
  avatar_meta jsonb
);

create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_team on public.profiles(team_id);
create index if not exists idx_profiles_coord on public.profiles(coord_id);
create index if not exists idx_profiles_division on public.profiles(division_id);

-- Roles per user
create table if not exists public.user_roles (
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null,
  primary key (user_id, role)
);

-- Pending registrations (self-serve signup requests)
create table if not exists public.pending_registrations (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  telefone text,
  matricula text,
  operational_base text not null,
  sigla_area text not null,
  status registration_status not null default 'pending'
);
create index if not exists idx_pending_registrations_status on public.pending_registrations(status);

create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  identifier text not null,
  reason text,
  status password_reset_status not null default 'pending',
  requested_at timestamptz not null default now(),
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz,
  reviewer_notes text
);
create index if not exists idx_password_reset_requests_status on public.password_reset_requests(status);

-- Gamification: challenges, events, badges
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  type text not null,
  xp_reward integer not null default 0
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid references public.challenges(id) on delete set null,
  status text not null default 'submitted',
  points_calculated integer default 0,
  retry_count smallint not null default 0,
  parent_event_id uuid references public.events(id) on delete set null,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists idx_events_user on public.events(user_id);
create index if not exists idx_events_challenge on public.events(challenge_id);
create index if not exists idx_events_status on public.events(status);

create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  icon_url text
);

create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now()
);
create index if not exists idx_user_badges_user on public.user_badges(user_id);

-- Forums (minimal)
create table if not exists public.forum_topics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  title text not null,
  is_active boolean not null default true,
  posts_count integer not null default 0,
  last_post_at timestamptz
);

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  topic_id uuid not null references public.forum_topics(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  is_solution boolean not null default false
);
create index if not exists idx_forum_posts_topic on public.forum_posts(topic_id);

-- Helper functions for RLS
create or replace function public.has_role(u uuid, r text)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = u and ur.role::text = r::text
  );
$$;

create or replace function public.is_staff(u uuid)
returns boolean language sql stable as $$
  select coalesce(
    has_role(u, 'admin')
    or has_role(u, 'gerente_djt')
    or has_role(u, 'gerente_divisao_djtx')
    or has_role(u, 'coordenador_djtx')
  , false);
$$;

-- Insert profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles(id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''),'@',1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS policies
alter table public.profiles enable row level security;
do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='Profiles: self read';
  if not found then
    create policy "Profiles: self read" on public.profiles
      for select using (auth.uid() = id or public.is_staff(auth.uid()));
  end if;
end $$;
do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='Profiles: self update minimal';
  if not found then
    create policy "Profiles: self update minimal" on public.profiles
      for update using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;
do $$ begin
  perform 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='Profiles: staff manage';
  if not found then
    create policy "Profiles: staff manage" on public.profiles
      for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
end $$;

alter table public.user_roles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_roles' and policyname='UserRoles: admin manage') then
    create policy "UserRoles: admin manage" on public.user_roles
      for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
  end if;
end $$;

alter table public.pending_registrations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pending_registrations' and policyname='Pending: anyone insert') then
    create policy "Pending: anyone insert" on public.pending_registrations for insert with check (true);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pending_registrations' and policyname='Pending: staff read/update') then
    create policy "Pending: staff read/update" on public.pending_registrations for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
end $$;

alter table public.events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='Events: self read/insert') then
    create policy "Events: self read/insert" on public.events for select using (auth.uid() = user_id);
    create policy "Events: self insert" on public.events for insert with check (auth.uid() = user_id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='Events: staff read') then
    create policy "Events: staff read" on public.events for select using (public.is_staff(auth.uid()));
  end if;
end $$;

alter table public.forum_topics enable row level security;
alter table public.forum_posts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='forum_topics' and policyname='ForumTopics: read') then
    create policy "ForumTopics: read" on public.forum_topics for select using (true);
    create policy "ForumTopics: create" on public.forum_topics for insert with check (auth.uid() is not null);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='forum_posts' and policyname='ForumPosts: read') then
    create policy "ForumPosts: read" on public.forum_posts for select using (true);
    create policy "ForumPosts: create" on public.forum_posts for insert with check (auth.uid() = user_id);
  end if;
end $$;

-- Views used by dashboard
create or replace view public.team_xp_summary as
select
  p.team_id,
  coalesce(sum(p.xp),0)::int as total_xp
from public.profiles p
where p.team_id is not null and coalesce(p.is_leader,false) = false
group by p.team_id;

create or replace view public.team_challenge_performance as
with base as (
  select 
    p.team_id,
    e.challenge_id,
    count(distinct e.user_id) filter (where e.status in ('submitted','approved','rejected')) as participants_count,
    count(*) filter (where e.status = 'approved') as approvals,
    count(*) as total_events
  from public.events e
  join public.profiles p on p.id = e.user_id
  group by 1,2
), members as (
  select team_id, count(*) filter (where coalesce(is_leader,false)=false) as total_members
  from public.profiles
  group by 1
)
select
  b.team_id,
  b.challenge_id,
  c.title as challenge_title,
  100.0 * b.participants_count / nullif(m.total_members,0) as adhesion_percentage,
  100.0 * b.approvals / nullif(b.total_events,0) as completion_percentage,
  b.participants_count,
  m.total_members,
  avg(coalesce(c.xp_reward,0))::float as avg_xp_earned
from base b
left join members m on m.team_id = b.team_id
left join public.challenges c on c.id = b.challenge_id;

-- Minimal placeholder for campaigns: create view with zero rows but correct columns
create or replace view public.team_campaign_performance as
select
  cast(null as text) as campaign_id,
  cast(null as text) as campaign_title,
  cast(null as double precision) as adhesion_percentage,
  cast(null as double precision) as completion_percentage,
  cast(null as integer) as participants_count,
  cast(null as integer) as total_members,
  cast(null as text) as team_id
where false;

-- Storage: public bucket for avatars (read) - uploads happen via service role function
insert into storage.buckets (id, name, public)
values ('avatars','avatars', true)
on conflict (id) do nothing;

-- Optional: allow public read on avatars bucket
do $$ begin
  if not exists (
    select 1 from pg_policies 
    where schemaname='storage' and tablename='objects' and policyname='Avatars public read'
  ) then
    create policy "Avatars public read" on storage.objects
      for select using (bucket_id = 'avatars');
  end if;
end $$;
