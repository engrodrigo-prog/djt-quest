-- Create pending_registrations table for self-registration with approval
CREATE TABLE public.pending_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  telefone TEXT,
  matricula TEXT,
  operational_base TEXT NOT NULL,
  sigla_area TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone (even anonymous) can register
CREATE POLICY "Anyone can register"
  ON public.pending_registrations 
  FOR INSERT
  WITH CHECK (true);

-- Policy: Coordinators can view pending registrations
CREATE POLICY "Coordinators can view pending"
  ON public.pending_registrations 
  FOR SELECT
  USING (has_role(auth.uid(), 'coordenador_djtx'::app_role) 
         OR has_role(auth.uid(), 'gerente_divisao_djtx'::app_role) 
         OR has_role(auth.uid(), 'gerente_djt'::app_role));

-- Policy: Coordinators can update registration status
CREATE POLICY "Coordinators can update status"
  ON public.pending_registrations 
  FOR UPDATE
  USING (has_role(auth.uid(), 'coordenador_djtx'::app_role) 
         OR has_role(auth.uid(), 'gerente_divisao_djtx'::app_role) 
         OR has_role(auth.uid(), 'gerente_djt'::app_role));