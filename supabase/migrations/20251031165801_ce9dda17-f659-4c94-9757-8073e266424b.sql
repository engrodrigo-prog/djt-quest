-- Create pending_registrations table for self-registration with approval
CREATE TABLE IF NOT EXISTS public.pending_registrations (
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
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pending_registrations' AND policyname='Anyone can register'
  ) THEN
    CREATE POLICY "Anyone can register"
      ON public.pending_registrations 
      FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

-- Policy: Coordinators can view pending registrations
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pending_registrations' AND policyname='Coordinators can view pending'
  ) THEN
    CREATE POLICY "Coordinators can view pending"
      ON public.pending_registrations 
      FOR SELECT
      USING (has_role((select auth.uid()), 'coordenador_djtx') 
             OR has_role((select auth.uid()), 'gerente_divisao_djtx') 
             OR has_role((select auth.uid()), 'gerente_djt'));
  END IF;
END $$;

-- Policy: Coordinators can update registration status
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pending_registrations' AND policyname='Coordinators can update status'
  ) THEN
    CREATE POLICY "Coordinators can update status"
      ON public.pending_registrations 
      FOR UPDATE
      USING (has_role((select auth.uid()), 'coordenador_djtx') 
             OR has_role((select auth.uid()), 'gerente_divisao_djtx') 
             OR has_role((select auth.uid()), 'gerente_djt'));
  END IF;
END $$;
