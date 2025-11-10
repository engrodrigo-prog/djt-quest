-- Align challenges targeting columns with TEXT org IDs and add theme fields
ALTER TABLE public.challenges
  ALTER COLUMN target_team_ids TYPE text[] USING CASE WHEN target_team_ids IS NULL THEN NULL ELSE string_to_array(array_to_string(target_team_ids, ','), ',') END,
  ALTER COLUMN target_coord_ids TYPE text[] USING CASE WHEN target_coord_ids IS NULL THEN NULL ELSE string_to_array(array_to_string(target_coord_ids, ','), ',') END,
  ALTER COLUMN target_div_ids TYPE text[] USING CASE WHEN target_div_ids IS NULL THEN NULL ELSE string_to_array(array_to_string(target_div_ids, ','), ',') END,
  ALTER COLUMN target_dept_ids TYPE text[] USING CASE WHEN target_dept_ids IS NULL THEN NULL ELSE string_to_array(array_to_string(target_dept_ids, ','), ',') END;

-- Add optional theme/subtheme to help UX categorize challenges
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS theme text,
  ADD COLUMN IF NOT EXISTS subtheme text;

-- Optional helper index if filtering frequently
CREATE INDEX IF NOT EXISTS idx_challenges_theme ON public.challenges(theme);
CREATE INDEX IF NOT EXISTS idx_challenges_subtheme ON public.challenges(subtheme);
