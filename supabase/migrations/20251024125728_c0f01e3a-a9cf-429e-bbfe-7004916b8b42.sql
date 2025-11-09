-- 1. Criar ENUM para os 15 níveis
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'player_tier') THEN
    CREATE TYPE public.player_tier AS ENUM (
      'EX-1', 'EX-2', 'EX-3', 'EX-4', 'EX-5',
      'FO-1', 'FO-2', 'FO-3', 'FO-4', 'FO-5',
      'GU-1', 'GU-2', 'GU-3', 'GU-4', 'GU-5'
    );
  END IF;
END $$;

-- 2. Criar tipo para status de progressão de patamar
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tier_progression_status') THEN
    CREATE TYPE public.tier_progression_status AS ENUM (
      'pending',
      'challenge_created',
      'in_progress',
      'under_review',
      'approved',
      'rejected'
    );
  END IF;
END $$;

-- 3. Modificar tabela profiles (RESETAR DADOS)
TRUNCATE TABLE public.profiles RESTART IDENTITY CASCADE;

ALTER TABLE public.profiles 
  DROP COLUMN IF EXISTS level,
  ADD COLUMN IF NOT EXISTS tier player_tier NOT NULL DEFAULT 'EX-1',
  ADD COLUMN IF NOT EXISTS demotion_cooldown_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_progression_locked BOOLEAN DEFAULT FALSE;

-- 4. Criar tabela de solicitações de progressão de patamar
CREATE TABLE public.tier_progression_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  current_tier player_tier NOT NULL,
  target_tier player_tier NOT NULL,
  status tier_progression_status NOT NULL DEFAULT 'pending',
  special_challenge_id UUID REFERENCES public.challenges(id),
  special_event_id UUID REFERENCES public.events(id),
  coordinator_id UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Criar tabela de incidentes de segurança
CREATE TABLE public.safety_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  incident_type TEXT NOT NULL,
  is_near_miss BOOLEAN DEFAULT FALSE,
  description TEXT NOT NULL,
  evidence_urls TEXT[],
  reported_by UUID REFERENCES auth.users(id) NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  caused_demotion BOOLEAN DEFAULT FALSE,
  previous_tier player_tier,
  new_tier player_tier,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Criar tabela de log de rebaixamentos
CREATE TABLE public.tier_demotion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  incident_id UUID REFERENCES public.safety_incidents(id),
  previous_tier player_tier NOT NULL,
  new_tier player_tier NOT NULL,
  reason TEXT NOT NULL,
  demoted_by UUID REFERENCES auth.users(id) NOT NULL,
  demoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cooldown_until TIMESTAMPTZ NOT NULL
);

-- 7. Criar tabela de notificações
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::JSONB,
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Criar índices para performance
CREATE INDEX idx_profiles_tier ON public.profiles(tier);
CREATE INDEX idx_safety_incidents_user_id ON public.safety_incidents(user_id);
CREATE INDEX idx_safety_incidents_created_at ON public.safety_incidents(created_at);
CREATE INDEX idx_tier_progression_user_id ON public.tier_progression_requests(user_id);
CREATE INDEX idx_tier_progression_status ON public.tier_progression_requests(status);
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_read ON public.notifications(read);

-- 9. Função: Calcular tier baseado em XP
CREATE OR REPLACE FUNCTION public.calculate_tier_from_xp(
  _xp INTEGER, 
  _current_tier player_tier
)
RETURNS player_tier
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  tier_prefix TEXT;
BEGIN
  tier_prefix := SPLIT_PART(_current_tier::TEXT, '-', 1);
  
  IF tier_prefix = 'EX' THEN
    IF _xp >= 1800 THEN RETURN 'EX-5'::player_tier;
    ELSIF _xp >= 1200 THEN RETURN 'EX-4'::player_tier;
    ELSIF _xp >= 700 THEN RETURN 'EX-3'::player_tier;
    ELSIF _xp >= 300 THEN RETURN 'EX-2'::player_tier;
    ELSE RETURN 'EX-1'::player_tier;
    END IF;
  END IF;
  
  IF tier_prefix = 'FO' THEN
    IF _xp >= 2200 THEN RETURN 'FO-5'::player_tier;
    ELSIF _xp >= 1500 THEN RETURN 'FO-4'::player_tier;
    ELSIF _xp >= 900 THEN RETURN 'FO-3'::player_tier;
    ELSIF _xp >= 400 THEN RETURN 'FO-2'::player_tier;
    ELSE RETURN 'FO-1'::player_tier;
    END IF;
  END IF;
  
  IF tier_prefix = 'GU' THEN
    IF _xp >= 2600 THEN RETURN 'GU-5'::player_tier;
    ELSIF _xp >= 1800 THEN RETURN 'GU-4'::player_tier;
    ELSIF _xp >= 1100 THEN RETURN 'GU-3'::player_tier;
    ELSIF _xp >= 500 THEN RETURN 'GU-2'::player_tier;
    ELSE RETURN 'GU-1'::player_tier;
    END IF;
  END IF;
  
  RETURN _current_tier;
END;
$$;

-- 10. Função: Rebaixar por incidente de segurança
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
  SELECT tier INTO current_tier
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

-- 11. Função: Criar notificação
CREATE OR REPLACE FUNCTION public.create_notification(
  _user_id UUID,
  _type TEXT,
  _title TEXT,
  _message TEXT,
  _metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_id UUID;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message, metadata)
  VALUES (_user_id, _type, _title, _message, _metadata)
  RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$;

-- 12. RLS Policies para safety_incidents
ALTER TABLE public.safety_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leaders can view all incidents"
ON public.safety_incidents FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'gerente'::app_role) OR
  has_role(auth.uid(), 'lider_divisao'::app_role) OR
  has_role(auth.uid(), 'coordenador'::app_role)
);

CREATE POLICY "Users can view own incidents"
ON public.safety_incidents FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Leaders can create incidents"
ON public.safety_incidents FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'lider_divisao'::app_role) OR
  has_role(auth.uid(), 'coordenador'::app_role) OR
  has_role(auth.uid(), 'gerente'::app_role) OR
  has_role(auth.uid(), 'admin'::app_role)
);

-- 13. RLS Policies para tier_demotion_log
ALTER TABLE public.tier_demotion_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All can view demotion log"
ON public.tier_demotion_log FOR SELECT
USING (TRUE);

-- 14. RLS Policies para tier_progression_requests
ALTER TABLE public.tier_progression_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own progression requests"
ON public.tier_progression_requests FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Leaders can view all progression requests"
ON public.tier_progression_requests FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'gerente'::app_role) OR
  has_role(auth.uid(), 'lider_divisao'::app_role) OR
  has_role(auth.uid(), 'coordenador'::app_role)
);

CREATE POLICY "System can manage progression requests"
ON public.tier_progression_requests FOR ALL
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'gerente'::app_role) OR
  has_role(auth.uid(), 'coordenador'::app_role)
);

-- 15. RLS Policies para notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
ON public.notifications FOR UPDATE
USING (auth.uid() = user_id);
