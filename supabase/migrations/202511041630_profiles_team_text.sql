alter table public.profiles
  alter column team_id type text using team_id::text,
  alter column coord_id type text using coord_id::text;
