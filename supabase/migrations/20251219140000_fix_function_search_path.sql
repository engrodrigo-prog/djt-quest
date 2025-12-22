-- Fix search_path for functions flagged by Supabase linter.
DO $$
BEGIN
  IF to_regprocedure('public.increment_sepbook_comment_count(uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_sepbook_comment_count(uuid) SET search_path = public';
  END IF;

  IF to_regprocedure('public.increment_profile_xp(uuid, integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_profile_xp(uuid, integer) SET search_path = public';
  END IF;

  IF to_regprocedure('public.increment_sepbook_profile_xp(uuid, integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_sepbook_profile_xp(uuid, integer) SET search_path = public';
  END IF;

  IF to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.update_updated_at_column() SET search_path = public';
  END IF;

  IF to_regprocedure('public.update_team_modifier_timestamp()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.update_team_modifier_timestamp() SET search_path = public';
  END IF;

  IF to_regprocedure('public.derive_division_from_team_id(text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.derive_division_from_team_id(text) SET search_path = public';
  END IF;

  IF to_regprocedure('public.team_member_count(text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.team_member_count(text) SET search_path = public';
  END IF;

  IF to_regprocedure('public.xp_achieved_for_team(timestamptz, timestamptz, text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.xp_achieved_for_team(timestamptz, timestamptz, text) SET search_path = public';
  END IF;

  IF to_regprocedure('public.team_adherence_window(timestamptz, timestamptz)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.team_adherence_window(timestamptz, timestamptz) SET search_path = public';
  END IF;

  IF to_regprocedure('public.division_adherence_window(timestamptz, timestamptz)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.division_adherence_window(timestamptz, timestamptz) SET search_path = public';
  END IF;

  IF to_regprocedure('public.increment_topic_post_count()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_topic_post_count() SET search_path = public';
  END IF;

  IF to_regprocedure('public.increment_post_likes()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_post_likes() SET search_path = public';
  END IF;

  IF to_regprocedure('public.increment_hashtag_usage()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.increment_hashtag_usage() SET search_path = public';
  END IF;

  IF to_regprocedure('public.is_staff(uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.is_staff(uuid) SET search_path = public';
  END IF;

  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.handle_new_user() SET search_path = public';
  END IF;

  IF to_regprocedure('public.calculate_tier_from_xp(integer, public.player_tier)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.calculate_tier_from_xp(integer, public.player_tier) SET search_path = public';
  END IF;

  IF to_regprocedure('public.calculate_tier_from_xp(integer, text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.calculate_tier_from_xp(integer, text) SET search_path = public';
  END IF;
END $$;
