-- Fix RLS policy to allow anonymous users to view profiles for login
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Public can view profiles'
  ) THEN
    CREATE POLICY "Public can view profiles"
      ON profiles
      FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;
