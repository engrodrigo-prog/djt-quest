-- Fix RLS policy to allow anonymous users to view profiles for login
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;

CREATE POLICY "Public can view profiles"
  ON profiles
  FOR SELECT
  TO public
  USING (true);