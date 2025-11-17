-- Ensure Rodrigo Nascimento (matrícula 601555) and Cintia Veiga Claudio have admin role
DO $$
DECLARE
  target_emails text[] := ARRAY['rodrigonasc@cpfl.com.br', 'cveiga@cpfl.com.br'];
BEGIN
  -- Promote existing roles to admin
  UPDATE public.user_roles ur
  SET role = 'admin'
  WHERE ur.user_id IN (
    SELECT id FROM public.profiles WHERE lower(email) = ANY(target_emails)
  );

  -- Insert missing admin roles if user had no row in user_roles
  INSERT INTO public.user_roles (user_id, role)
  SELECT p.id, 'admin'
  FROM public.profiles p
  WHERE lower(p.email) = ANY(target_emails)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id
    );
END $$;
