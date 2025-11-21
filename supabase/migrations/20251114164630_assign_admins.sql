-- Ensure Rodrigo Nascimento (matrícula 601555) and Cintia Veiga Claudio have admin role
DO $$
DECLARE
  target_emails text[] := ARRAY['rodrigonasc@cpfl.com.br', 'cveiga@cpfl.com.br'];
BEGIN
  -- Garante que exista uma linha (user_id,'admin') sem quebrar PK mesmo que o usuário já tenha outros papéis
  INSERT INTO public.user_roles (user_id, role)
  SELECT p.id, 'admin'
  FROM public.profiles p
  WHERE lower(p.email) = ANY(target_emails)
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
