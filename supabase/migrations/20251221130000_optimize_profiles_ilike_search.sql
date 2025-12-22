-- Performance: speed up ILIKE/contains searches used by Auth/User lookup.
-- Adds trigram indexes without changing query semantics.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'matricula'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_matricula_trgm ON public.profiles USING gin (matricula extensions.gin_trgm_ops)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'email'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_email_trgm ON public.profiles USING gin (email extensions.gin_trgm_ops)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'name'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_name_trgm ON public.profiles USING gin (name extensions.gin_trgm_ops)';
  END IF;
END $$;
