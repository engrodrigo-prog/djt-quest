-- ETAPA 2: Adicionar campos ao profiles e criar tabela de change requests
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS matricula TEXT,
ADD COLUMN IF NOT EXISTS operational_base TEXT,
ADD COLUMN IF NOT EXISTS sigla_area TEXT,
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS needs_profile_completion BOOLEAN DEFAULT false;

-- Criar tabela de solicitações de mudança de perfil
CREATE TABLE IF NOT EXISTS public.profile_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.profile_change_requests ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Users can view own change requests" ON public.profile_change_requests;
CREATE POLICY "Users can view own change requests"
ON public.profile_change_requests
FOR SELECT
USING (auth.uid() = user_id OR auth.uid() = requested_by);

DROP POLICY IF EXISTS "Users can create change requests for themselves" ON public.profile_change_requests;
CREATE POLICY "Users can create change requests for themselves"
ON public.profile_change_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Leaders can view requests in their hierarchy" ON public.profile_change_requests;
CREATE POLICY "Leaders can view requests in their hierarchy"
ON public.profile_change_requests
FOR SELECT
USING (
  has_role(auth.uid(), 'admin') OR
  has_role(auth.uid(), 'gerente_djt') OR
  has_role(auth.uid(), 'gerente_divisao_djtx') OR
  has_role(auth.uid(), 'coordenador_djtx')
);

DROP POLICY IF EXISTS "Leaders can update requests" ON public.profile_change_requests;
CREATE POLICY "Leaders can update requests"
ON public.profile_change_requests
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin') OR
  has_role(auth.uid(), 'gerente_djt') OR
  has_role(auth.uid(), 'gerente_divisao_djtx') OR
  has_role(auth.uid(), 'coordenador_djtx')
);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_profile_change_requests_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'update_profile_change_requests_updated_at' AND n.nspname = 'public' AND c.relname = 'profile_change_requests'
  ) THEN
    CREATE TRIGGER update_profile_change_requests_updated_at
    BEFORE UPDATE ON public.profile_change_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_profile_change_requests_updated_at();
  END IF;
END $$;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_profile_change_requests_user_id ON public.profile_change_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_change_requests_status ON public.profile_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_profiles_matricula ON public.profiles(matricula);
CREATE INDEX IF NOT EXISTS idx_profiles_sigla_area ON public.profiles(sigla_area);
