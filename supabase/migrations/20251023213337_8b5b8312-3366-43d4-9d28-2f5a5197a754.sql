-- Fix search_path for calculate_final_points function
CREATE OR REPLACE FUNCTION public.calculate_final_points(
  _base_xp integer,
  _quality_score numeric,
  _eval_multiplier numeric,
  _team_modifier numeric,
  _retry_count integer DEFAULT 0
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  retry_penalty numeric;
BEGIN
  -- Calculate retry penalty based on attempt number
  retry_penalty := CASE 
    WHEN _retry_count = 0 THEN 1.0
    WHEN _retry_count = 1 THEN 0.8
    WHEN _retry_count = 2 THEN 0.6
    ELSE 0.4
  END;
  
  RETURN FLOOR(
    _base_xp * 
    COALESCE(_quality_score, 1.0) * 
    COALESCE(_eval_multiplier, 1.0) * 
    COALESCE(_team_modifier, 1.0) *
    retry_penalty
  )::integer;
END;
$$;