do $$ begin
  if exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='team_id' and data_type <> 'text'
  ) then
    execute 'alter table public.profiles alter column team_id type text using team_id::text';
  end if;
  if exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='coord_id' and data_type <> 'text'
  ) then
    execute 'alter table public.profiles alter column coord_id type text using coord_id::text';
  end if;
end $$;
