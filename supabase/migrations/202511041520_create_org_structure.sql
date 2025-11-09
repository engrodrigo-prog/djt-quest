-- Ensure helper function exists
do $$ begin
  if to_regprocedure('public.has_role(uuid,text)') is null then
    create function public.has_role(uid uuid, role text)
    returns boolean language sql stable as $func$
      select exists(
        select 1 from public.user_roles ur
        where ur.user_id = uid and ur.role = has_role.role
      );
    $func$;
  end if;
end $$;

-- Departments
create table if not exists public.departments (
  id text primary key,
  name text not null,
  created_at timestamptz default timezone('utc', now())
);

insert into public.departments (id, name)
values ('DJT', 'Departamento DJT')
on conflict (id) do update set name = excluded.name;

-- Divisions
create table if not exists public.divisions (
  id text primary key,
  name text not null,
  department_id text references public.departments(id) on delete set null,
  created_at timestamptz default timezone('utc', now())
);

-- Coordinations
create table if not exists public.coordinations (
  id text primary key,
  name text not null,
  division_id text references public.divisions(id) on delete cascade,
  created_at timestamptz default timezone('utc', now())
);

-- Teams
-- Note: teams table exists with coord_id on some environments; keep this block safe
create table if not exists public.teams (
  id text primary key,
  name text not null,
  coord_id text references public.coordinations(id) on delete cascade,
  team_modifier numeric default 1.0,
  modifier_reason text,
  last_modifier_update timestamptz,
  created_at timestamptz default timezone('utc', now())
);

-- Ensure profiles reference the hierarchy
alter table public.profiles
  add column if not exists division_id text references public.divisions(id) on delete set null,
  add column if not exists coord_id text references public.coordinations(id) on delete set null,
  add column if not exists team_id text references public.teams(id) on delete set null;

create index if not exists profiles_division_idx on public.profiles(division_id);
create index if not exists profiles_coord_idx on public.profiles(coord_id);
create index if not exists profiles_team_idx on public.profiles(team_id);

-- Enable RLS with basic read policies
alter table public.divisions enable row level security;
alter table public.coordinations enable row level security;
alter table public.teams enable row level security;

drop policy if exists "Divisions are readable" on public.divisions;
create policy "Divisions are readable"
  on public.divisions for select
  to authenticated
  using (true);

drop policy if exists "Coordinations are readable" on public.coordinations;
create policy "Coordinations are readable"
  on public.coordinations for select
  to authenticated
  using (true);

drop policy if exists "Teams are readable" on public.teams;
create policy "Teams are readable"
  on public.teams for select
  to authenticated
  using (true);
