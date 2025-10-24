-- Add missing columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS studio_access BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS coord_id UUID REFERENCES public.coordinations(id),
ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES public.divisions(id),
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_coord ON public.profiles(coord_id);
CREATE INDEX IF NOT EXISTS idx_profiles_division ON public.profiles(division_id);
CREATE INDEX IF NOT EXISTS idx_profiles_department ON public.profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_profiles_studio_access ON public.profiles(studio_access);

-- Update studio_access for existing users based on their roles
UPDATE public.profiles p
SET studio_access = TRUE
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = p.id
    AND ur.role IN ('coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt')
);

-- Create or replace trigger function to maintain studio_access synchronized with roles
CREATE OR REPLACE FUNCTION public.update_studio_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET studio_access = EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.user_id
      AND role IN ('coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt')
  )
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists and create new one
DROP TRIGGER IF EXISTS trigger_update_studio_access ON public.user_roles;
CREATE TRIGGER trigger_update_studio_access
AFTER INSERT OR UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.update_studio_access();