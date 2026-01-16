-- Add finance analyst role to app_role enum (idempotent)
-- Required for: user_roles.role::app_role inserts + has_role(..., 'analista_financeiro')
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND typnamespace = 'public'::regnamespace) THEN
    BEGIN
      EXECUTE 'ALTER TYPE public.app_role ADD VALUE ''analista_financeiro''';
    EXCEPTION WHEN duplicate_object THEN
      -- ignore
    END;
  END IF;
END$$;

