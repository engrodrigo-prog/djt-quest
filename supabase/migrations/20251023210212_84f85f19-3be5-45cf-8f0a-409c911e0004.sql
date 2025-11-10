-- Add team performance modifiers
ALTER TABLE public.teams 
  ADD COLUMN IF NOT EXISTS team_modifier NUMERIC DEFAULT 1.0 CHECK (team_modifier >= 0.7 AND team_modifier <= 1.3);
ALTER TABLE public.teams 
  ADD COLUMN IF NOT EXISTS last_modifier_update TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.teams 
  ADD COLUMN IF NOT EXISTS modifier_reason TEXT;

-- Create team performance log table
CREATE TABLE IF NOT EXISTS public.team_performance_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id TEXT NOT NULL,
  previous_modifier NUMERIC NOT NULL,
  new_modifier NUMERIC NOT NULL,
  reason TEXT,
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on team_performance_log
ALTER TABLE public.team_performance_log ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can view performance log
DROP POLICY IF EXISTS "All can view team performance log" ON public.team_performance_log;
CREATE POLICY "All can view team performance log"
ON public.team_performance_log
FOR SELECT
USING (true);

-- Policy: Only coordinators and above can insert performance log
DROP POLICY IF EXISTS "Leaders can log performance changes" ON public.team_performance_log;
CREATE POLICY "Leaders can log performance changes"
ON public.team_performance_log
FOR INSERT
WITH CHECK (
  has_role((select auth.uid()), 'coordenador_djtx') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'gerente_djt') OR
  has_role((select auth.uid()), 'admin')
);

-- Add evaluation assignment fields to events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS assigned_evaluator_id UUID REFERENCES auth.users(id);
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS assignment_type TEXT CHECK (assignment_type IN ('same_area', 'cross_area', 'auto'));

-- Create evaluation queue table for cyclic distribution
CREATE TABLE IF NOT EXISTS public.evaluation_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE UNIQUE,
  assigned_to UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  is_cross_evaluation BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on evaluation_queue
ALTER TABLE public.evaluation_queue ENABLE ROW LEVEL SECURITY;

-- Policy: Leaders can view evaluation queue
DROP POLICY IF EXISTS "Leaders can view evaluation queue" ON public.evaluation_queue;
CREATE POLICY "Leaders can view evaluation queue"
ON public.evaluation_queue
FOR SELECT
USING (
  has_role((select auth.uid()), 'coordenador_djtx') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'gerente_djt') OR
  has_role((select auth.uid()), 'admin')
);

-- Policy: System can insert into evaluation queue
DROP POLICY IF EXISTS "System can manage evaluation queue" ON public.evaluation_queue;
CREATE POLICY "System can manage evaluation queue"
ON public.evaluation_queue
FOR ALL
USING (
  has_role((select auth.uid()), 'admin') OR
  has_role((select auth.uid()), 'gerente_djt')
);

-- Add trigger to update team modifier timestamp
CREATE OR REPLACE FUNCTION public.update_team_modifier_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.team_modifier IS DISTINCT FROM OLD.team_modifier THEN
    NEW.last_modifier_update = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_team_modifier_timestamp_trigger ON public.teams;
CREATE TRIGGER update_team_modifier_timestamp_trigger
BEFORE UPDATE ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.update_team_modifier_timestamp();

-- Function to calculate final points with team modifier
CREATE OR REPLACE FUNCTION public.calculate_final_points(
  _base_xp INTEGER,
  _quality_score NUMERIC,
  _eval_multiplier NUMERIC,
  _team_modifier NUMERIC
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT FLOOR(_base_xp * COALESCE(_quality_score, 1.0) * COALESCE(_eval_multiplier, 1.0) * COALESCE(_team_modifier, 1.0))::INTEGER
$$;

-- Update events table to store final points with team modifier
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS team_modifier_applied NUMERIC;
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS final_points INTEGER;
