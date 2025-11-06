-- Add date_of_birth column to profiles if not exists
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS date_of_birth date;

-- Optional index for birthday queries
CREATE INDEX IF NOT EXISTS idx_profiles_date_of_birth ON public.profiles(date_of_birth);
