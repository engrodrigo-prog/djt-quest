-- Add telefone and allow nulls for safe rollout
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telefone text;

-- Optional index if filtering by phone becomes common
-- CREATE INDEX IF NOT EXISTS idx_profiles_telefone ON public.profiles(telefone);

