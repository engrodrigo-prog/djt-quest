-- Fixes prompted by `supabase db lint` on the remote project.
-- Goal: remove schema/function errors without changing existing app behavior.

-- 1) Events: missing eval_multiplier (used by update_event_points)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS eval_multiplier numeric(3,2) DEFAULT 1.0;

-- 2) Tier calculation: provide overload for text tiers (profiles.tier is TEXT)
-- Existing function: calculate_tier_from_xp(integer, player_tier) -> player_tier
-- This wrapper keeps storage as TEXT while reusing the enum logic.
CREATE OR REPLACE FUNCTION public.calculate_tier_from_xp(
  _xp integer,
  _current_tier text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  t player_tier;
BEGIN
  IF _current_tier IS NULL OR btrim(_current_tier) = '' THEN
    RETURN 'EX-1';
  END IF;

  BEGIN
    t := _current_tier::player_tier;
  EXCEPTION WHEN others THEN
    -- Keep the original value if it is not a valid enum literal.
    RETURN _current_tier;
  END;

  RETURN public.calculate_tier_from_xp(_xp, t)::text;
END;
$$;

-- 3) Safety demotion: explicit cast from profiles.tier (TEXT) to player_tier
CREATE OR REPLACE FUNCTION public.demote_for_safety_incident(
  _user_id UUID,
  _incident_id UUID,
  _demoted_by UUID,
  _cooldown_days INTEGER DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_tier player_tier;
  base_tier player_tier;
  tier_prefix TEXT;
  cooldown_date TIMESTAMPTZ;
  result JSONB;
BEGIN
  SELECT tier::player_tier INTO current_tier
  FROM public.profiles
  WHERE id = _user_id;
  
  tier_prefix := SPLIT_PART(current_tier::TEXT, '-', 1);
  base_tier := (tier_prefix || '-1')::player_tier;
  
  IF current_tier = base_tier THEN
    cooldown_date := NOW() + (_cooldown_days || ' days')::INTERVAL;
    
    UPDATE public.profiles
    SET demotion_cooldown_until = cooldown_date
    WHERE id = _user_id;
    
    result := jsonb_build_object(
      'success', false,
      'message', 'Usuário já está no nível Base',
      'current_tier', current_tier,
      'cooldown_extended', true
    );
    RETURN result;
  END IF;
  
  cooldown_date := NOW() + (_cooldown_days || ' days')::INTERVAL;
  
  UPDATE public.profiles
  SET 
    tier = base_tier,
    demotion_cooldown_until = cooldown_date,
    updated_at = NOW()
  WHERE id = _user_id;
  
  INSERT INTO public.tier_demotion_log (
    user_id, incident_id, previous_tier, new_tier, 
    reason, demoted_by, cooldown_until
  ) VALUES (
    _user_id, _incident_id, current_tier, base_tier,
    'Rebaixamento por incidente de segurança',
    _demoted_by, cooldown_date
  );
  
  UPDATE public.safety_incidents
  SET 
    caused_demotion = TRUE,
    previous_tier = current_tier,
    new_tier = base_tier
  WHERE id = _incident_id;
  
  result := jsonb_build_object(
    'success', true,
    'previous_tier', current_tier,
    'new_tier', base_tier,
    'cooldown_until', cooldown_date
  );
  
  RETURN result;
END;
$$;

-- 4) Evaluator assignment: match the existing partial unique index on evaluation_queue
-- `idx_evaluation_queue_event_assignee` is UNIQUE (event_id, assigned_to) WHERE assigned_to IS NOT NULL
CREATE OR REPLACE FUNCTION public.assign_evaluators_for_event(_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_immediate uuid;
  c_leader uuid;
  c_manager uuid;
  _submitter uuid;
  _team text;
  _coord text;
  _div text;
BEGIN
  SELECT e.user_id, p.team_id, p.coord_id, p.division_id
    INTO _submitter, _team, _coord, _div
  FROM public.events e
  JOIN public.profiles p ON p.id = e.user_id
  WHERE e.id = _event_id;

  -- immediate leader: same team leader if exists, else same coord/division leader
  SELECT id INTO c_immediate
  FROM public.profiles 
  WHERE is_leader = true AND team_id = _team AND id <> _submitter
  LIMIT 1;

  IF c_immediate IS NULL THEN
    SELECT p.id INTO c_immediate
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.coord_id = _coord AND p.id <> _submitter
      AND ur.role IN ('coordenador_djtx','gerente_divisao_djtx','gerente_djt')
    ORDER BY p.id
    LIMIT 1;
  END IF;

  IF c_immediate IS NULL THEN
    SELECT p.id INTO c_immediate
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.division_id = _div AND p.id <> _submitter
      AND ur.role IN ('coordenador_djtx','gerente_divisao_djtx','gerente_djt')
    ORDER BY p.id
    LIMIT 1;
  END IF;

  -- random leader (same division, exclude immediate/submitter, prefer lowest pending)
  WITH candidates AS (
    SELECT ur.user_id,
           COALESCE((SELECT COUNT(*) FROM public.evaluation_queue eq WHERE eq.assigned_to = ur.user_id AND eq.completed_at IS NULL),0) AS pending,
           COALESCE((SELECT MAX(assigned_at) FROM public.evaluation_queue eq2 WHERE eq2.assigned_to = ur.user_id), to_timestamp(0)) AS last_assigned
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('coordenador_djtx','gerente_divisao_djtx')
      AND p.division_id = _div
      AND ur.user_id <> COALESCE(c_immediate, '00000000-0000-0000-0000-000000000000')::uuid
      AND ur.user_id <> _submitter
  )
  SELECT user_id INTO c_leader
  FROM candidates
  ORDER BY pending ASC, last_assigned ASC, random()
  LIMIT 1;

  -- division manager from mapping; fallback to any gerente_djt
  SELECT manager_user_id INTO c_manager
  FROM public.division_managers
  WHERE division_id = _div;

  IF c_manager IS NULL THEN
    SELECT ur.user_id INTO c_manager
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'gerente_djt' AND p.division_id = _div AND ur.user_id <> _submitter
    ORDER BY random()
    LIMIT 1;
  END IF;

  -- Insert assignments (ignore duplicates/nulls)
  IF c_immediate IS NOT NULL THEN
    INSERT INTO public.evaluation_queue(event_id, assigned_to, assigned_at)
    VALUES (_event_id, c_immediate, now())
    ON CONFLICT (event_id, assigned_to) WHERE assigned_to IS NOT NULL DO NOTHING;
  END IF;

  IF c_leader IS NOT NULL THEN
    INSERT INTO public.evaluation_queue(event_id, assigned_to, assigned_at)
    VALUES (_event_id, c_leader, now())
    ON CONFLICT (event_id, assigned_to) WHERE assigned_to IS NOT NULL DO NOTHING;
  END IF;

  IF c_manager IS NOT NULL THEN
    INSERT INTO public.evaluation_queue(event_id, assigned_to, assigned_at)
    VALUES (_event_id, c_manager, now())
    ON CONFLICT (event_id, assigned_to) WHERE assigned_to IS NOT NULL DO NOTHING;
  END IF;
END;
$$;

