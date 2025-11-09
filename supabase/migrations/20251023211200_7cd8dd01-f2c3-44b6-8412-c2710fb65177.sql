-- Create avatars storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Avatar images are publicly accessible'
  ) THEN
    CREATE POLICY "Avatar images are publicly accessible"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Users can upload their own avatar'
  ) THEN
    CREATE POLICY "Users can upload their own avatar"
    ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'avatars' AND 
      auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Users can update their own avatar'
  ) THEN
    CREATE POLICY "Users can update their own avatar"
    ON storage.objects FOR UPDATE
    USING (
      bucket_id = 'avatars' AND 
      auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Users can delete their own avatar'
  ) THEN
    CREATE POLICY "Users can delete their own avatar"
    ON storage.objects FOR DELETE
    USING (
      bucket_id = 'avatars' AND 
      auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;
END $$;

-- Add avatar fields to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS avatar_thumbnail_url TEXT;

-- Update existing organizational data to match DJT structure
-- First, clear existing data
TRUNCATE TABLE public.teams CASCADE;
TRUNCATE TABLE public.coordinations CASCADE;
TRUNCATE TABLE public.divisions CASCADE;
TRUNCATE TABLE public.departments CASCADE;

-- Insert DJT department
INSERT INTO public.departments (id, name) VALUES 
('d1111111-1111-1111-1111-111111111111'::uuid, 'DJT - Subtransmissão CPFL');

-- Insert divisions (DJTV, DJTB, DJTX)
INSERT INTO public.divisions (id, name, department_id) VALUES 
('00000001-0000-0000-0000-000000000001'::uuid, 'DJTV', 'd1111111-1111-1111-1111-111111111111'::uuid),
('00000002-0000-0000-0000-000000000002'::uuid, 'DJTB', 'd1111111-1111-1111-1111-111111111111'::uuid),
('00000003-0000-0000-0000-000000000003'::uuid, 'DJTX', 'd1111111-1111-1111-1111-111111111111'::uuid);

-- Insert coordinations for each division
INSERT INTO public.coordinations (id, name, division_id) VALUES 
('00000011-0000-0000-0000-000000000001'::uuid, 'DJTV-PJU', '00000001-0000-0000-0000-000000000001'::uuid),
('00000012-0000-0000-0000-000000000002'::uuid, 'DJTV-ITP', '00000001-0000-0000-0000-000000000001'::uuid),
('00000013-0000-0000-0000-000000000003'::uuid, 'DJTV-JUN', '00000001-0000-0000-0000-000000000001'::uuid),
('00000014-0000-0000-0000-000000000004'::uuid, 'DJTV-VOT', '00000001-0000-0000-0000-000000000001'::uuid),
('00000021-0000-0000-0000-000000000001'::uuid, 'DJTB-CUB', '00000002-0000-0000-0000-000000000002'::uuid),
('00000022-0000-0000-0000-000000000002'::uuid, 'DJTB-STO', '00000002-0000-0000-0000-000000000002'::uuid),
('00000031-0000-0000-0000-000000000001'::uuid, 'DJTX-ABC', '00000003-0000-0000-0000-000000000003'::uuid);

-- Insert teams
INSERT INTO public.teams (id, name, coordination_id) VALUES 
('00000111-0000-0000-0000-000000000001'::uuid, 'DJTV PJU', '00000011-0000-0000-0000-000000000001'::uuid),
('00000112-0000-0000-0000-000000000002'::uuid, 'DJTV ITP', '00000012-0000-0000-0000-000000000002'::uuid),
('00000113-0000-0000-0000-000000000003'::uuid, 'DJTV JUN', '00000013-0000-0000-0000-000000000003'::uuid),
('00000114-0000-0000-0000-000000000004'::uuid, 'DJTV VOT', '00000014-0000-0000-0000-000000000004'::uuid),
('00000121-0000-0000-0000-000000000001'::uuid, 'DJTB CUB', '00000021-0000-0000-0000-000000000001'::uuid),
('00000122-0000-0000-0000-000000000002'::uuid, 'DJTB STO', '00000022-0000-0000-0000-000000000002'::uuid);
