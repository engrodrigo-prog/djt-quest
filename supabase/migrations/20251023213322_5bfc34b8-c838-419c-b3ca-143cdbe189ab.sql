-- Add retry statuses to event_status enum
ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'retry_pending';
ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'retry_in_progress';

-- Add fields to events table for retry functionality
ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS parent_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0 NOT NULL;

-- Create index for better performance on retry queries
CREATE INDEX IF NOT EXISTS idx_events_parent_event ON public.events(parent_event_id);
CREATE INDEX IF NOT EXISTS idx_events_retry_count ON public.events(retry_count);

-- Update calculate_final_points function to include retry penalty
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