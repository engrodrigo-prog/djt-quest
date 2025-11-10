-- Cleanup duplicate/legacy profile indexes flagged by Supabase linter
DO $$
BEGIN
  IF to_regclass('public.profiles_coord_idx') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.profiles_coord_idx';
  END IF;

  IF to_regclass('public.profiles_division_idx') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.profiles_division_idx';
  END IF;

  IF to_regclass('public.profiles_team_idx') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.profiles_team_idx';
  END IF;

  IF to_regclass('public.idx_profiles_team_id') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.idx_profiles_team_id';
  END IF;
END
$$;
