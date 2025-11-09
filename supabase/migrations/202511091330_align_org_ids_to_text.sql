-- Align organization IDs to TEXT across divisions, coordinations, teams, and related FKs
-- Idempotent: only alters when current type is uuid and columns exist.

do $$
declare
  v_type text;
begin
  -- Helper: returns data_type of a column or null
  -- Not necessary to create a function; use inline queries per column

  -- 1) divisions.id -> text
  select data_type into v_type from information_schema.columns
    where table_schema='public' and table_name='divisions' and column_name='id';
  if v_type = 'uuid' then
    execute 'alter table public.divisions alter column id type text using id::text';
  end if;

  -- 2) coordinations.id -> text
  select data_type into v_type from information_schema.columns
    where table_schema='public' and table_name='coordinations' and column_name='id';
  if v_type = 'uuid' then
    execute 'alter table public.coordinations alter column id type text using id::text';
  end if;

  -- 2a) coordinations.division_id -> text + FK to divisions(id)
  if exists (
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='coordinations' and column_name='division_id'
  ) then
    select data_type into v_type from information_schema.columns
      where table_schema='public' and table_name='coordinations' and column_name='division_id';
    if v_type = 'uuid' then
      execute 'alter table public.coordinations alter column division_id type text using division_id::text';
    end if;
    begin
      execute 'alter table public.coordinations drop constraint if exists coordinations_division_id_fkey';
    exception when others then null; end;
    begin
      execute 'alter table public.coordinations add constraint coordinations_division_id_fkey foreign key (division_id) references public.divisions(id) on delete set null';
    exception when others then null; end;
  end if;

  -- 3) teams.id -> text
  select data_type into v_type from information_schema.columns
    where table_schema='public' and table_name='teams' and column_name='id';
  if v_type = 'uuid' then
    execute 'alter table public.teams alter column id type text using id::text';
  end if;

  -- 3a) teams.coord_id: create from coordination_id if needed; ensure text
  if exists (
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='teams' and column_name='coordination_id'
  ) and not exists (
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='teams' and column_name='coord_id'
  ) then
    execute 'alter table public.teams add column coord_id text';
    -- Migrate values
    begin
      execute 'update public.teams set coord_id = coordination_id::text';
    exception when others then
      -- best effort; ignore if types mismatch or column empty
      null;
    end;
    -- Drop old FK and column if present
    begin
      execute 'alter table public.teams drop constraint if exists teams_coordination_id_fkey';
    exception when others then null; end;
    execute 'alter table public.teams drop column coordination_id';
  end if;

  -- Ensure teams.coord_id is text
  if exists (
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='teams' and column_name='coord_id'
  ) then
    select data_type into v_type from information_schema.columns
      where table_schema='public' and table_name='teams' and column_name='coord_id';
    if v_type = 'uuid' then
      execute 'alter table public.teams alter column coord_id type text using coord_id::text';
    end if;
  end if;

  -- 4) profiles.* -> ensure columns exist and are text
  -- team_id
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='team_id') then
    select data_type into v_type from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='team_id';
    if v_type = 'uuid' then
      execute 'alter table public.profiles alter column team_id type text using team_id::text';
    end if;
  end if;

  -- coord_id (add if missing)
  if not exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='coord_id'
  ) then
    execute 'alter table public.profiles add column coord_id text';
  else
    select data_type into v_type from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='coord_id';
    if v_type = 'uuid' then
      execute 'alter table public.profiles alter column coord_id type text using coord_id::text';
    end if;
  end if;

  -- division_id (add if missing)
  if not exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='division_id'
  ) then
    execute 'alter table public.profiles add column division_id text';
  else
    select data_type into v_type from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='division_id';
    if v_type = 'uuid' then
      execute 'alter table public.profiles alter column division_id type text using division_id::text';
    end if;
  end if;

  -- 5) team_performance_log.team_id -> text and FK to public.teams(id)
  if exists (
    select 1 from information_schema.tables where table_schema='public' and table_name='team_performance_log'
  ) then
    if exists (
      select 1 from information_schema.columns where table_schema='public' and table_name='team_performance_log' and column_name='team_id'
    ) then
      select data_type into v_type from information_schema.columns
        where table_schema='public' and table_name='team_performance_log' and column_name='team_id';
      if v_type = 'uuid' then
        execute 'alter table public.team_performance_log alter column team_id type text using team_id::text';
      end if;
    end if;
    -- Drop old FK if exists, then (re)add with text types
    begin
      execute 'alter table public.team_performance_log drop constraint if exists team_performance_log_team_id_fkey';
    exception when others then null; end;
    begin
      execute 'alter table public.team_performance_log add constraint team_performance_log_team_id_fkey foreign key (team_id) references public.teams(id) on delete cascade';
    exception when others then null; end;
  end if;

  -- 6) Recreate/ensure FKs for org text IDs (best effort)
  -- profiles.team_id -> teams(id)
  begin
    execute 'alter table public.profiles drop constraint if exists profiles_team_id_fkey';
  exception when others then null; end;
  begin
    execute 'alter table public.profiles add constraint profiles_team_id_fkey foreign key (team_id) references public.teams(id) on delete set null';
  exception when others then null; end;

  -- profiles.coord_id -> coordinations(id)
  begin
    execute 'alter table public.profiles drop constraint if exists profiles_coord_id_fkey';
  exception when others then null; end;
  begin
    execute 'alter table public.profiles add constraint profiles_coord_id_fkey foreign key (coord_id) references public.coordinations(id) on delete set null';
  exception when others then null; end;

  -- profiles.division_id -> divisions(id)
  begin
    execute 'alter table public.profiles drop constraint if exists profiles_division_id_fkey';
  exception when others then null; end;
  begin
    execute 'alter table public.profiles add constraint profiles_division_id_fkey foreign key (division_id) references public.divisions(id) on delete set null';
  exception when others then null; end;

end $$;
