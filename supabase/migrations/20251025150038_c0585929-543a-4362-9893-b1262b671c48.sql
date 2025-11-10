-- ============================================
-- FASE 1: Reestruturação do Modelo de Líderes
-- ============================================

-- 1.1 Adicionar coluna is_leader em profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_leader BOOLEAN DEFAULT FALSE;

-- 1.2 Criar índice para busca de líderes
CREATE INDEX IF NOT EXISTS idx_profiles_is_leader ON public.profiles(is_leader) WHERE is_leader = TRUE;

-- 1.3 Criar tabela de eventos de equipe (bônus/penalidade)
CREATE TABLE IF NOT EXISTS public.team_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('bonus', 'penalty')),
  points INTEGER NOT NULL CHECK (points > 0),
  reason TEXT NOT NULL CHECK (LENGTH(reason) >= 50),
  affected_users UUID[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_events_team ON public.team_events(team_id, created_at DESC);
ALTER TABLE public.team_events ENABLE ROW LEVEL SECURITY;

-- RLS: Líderes da equipe podem criar eventos
DROP POLICY IF EXISTS "Team leaders can create team events" ON public.team_events;
CREATE POLICY "Team leaders can create team events"
ON public.team_events FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = (select auth.uid()) 
      AND is_leader = TRUE 
      AND team_id = team_events.team_id
  )
);

-- RLS: Membros da equipe podem ver eventos
DROP POLICY IF EXISTS "Team members can view team events" ON public.team_events;
CREATE POLICY "Team members can view team events"
ON public.team_events FOR SELECT
USING (
  (select auth.uid()) = created_by OR
  (select auth.uid()) = ANY(affected_users) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = (select auth.uid()) 
      AND team_id = team_events.team_id
  )
);

DROP VIEW IF EXISTS public.team_xp_summary;
CREATE OR REPLACE VIEW public.team_xp_summary AS
SELECT 
  t.id AS team_id,
  t.name AS team_name,
  COUNT(p.id) FILTER (WHERE p.is_leader = FALSE) AS collaborator_count,
  COALESCE(AVG(p.xp) FILTER (WHERE p.is_leader = FALSE), 0)::INTEGER AS avg_xp,
  COALESCE(SUM(p.xp) FILTER (WHERE p.is_leader = FALSE), 0)::INTEGER AS total_xp,
  MAX(p.xp) FILTER (WHERE p.is_leader = FALSE) AS max_xp,
  MIN(p.xp) FILTER (WHERE p.is_leader = FALSE) AS min_xp
FROM public.teams t
LEFT JOIN public.profiles p ON p.team_id = t.id
GROUP BY t.id, t.name;

-- 1.5 Atualizar trigger para sincronizar studio_access
DROP TRIGGER IF EXISTS trigger_update_studio_access ON public.user_roles;
DROP TRIGGER IF EXISTS sync_leader_access_trigger ON public.user_roles;
DROP FUNCTION IF EXISTS public.update_studio_access() CASCADE;
DROP FUNCTION IF EXISTS public.sync_leader_studio_access() CASCADE;

CREATE OR REPLACE FUNCTION public.sync_leader_studio_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Atualizar is_leader e studio_access baseado em roles
  UPDATE public.profiles
  SET 
    is_leader = EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = NEW.user_id
        AND role IN ('coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt')
    ),
    studio_access = EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = NEW.user_id
        AND role IN ('coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt')
    )
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_leader_access_trigger
AFTER INSERT OR UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.sync_leader_studio_access();

-- 1.6 Script para marcar líderes existentes
UPDATE public.profiles
SET 
  is_leader = TRUE,
  studio_access = TRUE
WHERE id IN (
  SELECT user_id FROM public.user_roles 
  WHERE role IN ('coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt')
);

-- 1.7 Zerar XP dos líderes (eles não competem)
UPDATE public.profiles
SET xp = 0, tier = 'EX-1'
WHERE is_leader = TRUE;
