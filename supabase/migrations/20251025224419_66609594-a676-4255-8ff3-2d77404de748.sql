-- Criar bucket para anexos de fórum
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'forum-attachments',
  'forum-attachments',
  true,
  52428800,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public;

-- RLS: Usuários autenticados podem fazer upload
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Authenticated users can upload forum attachments'
  ) THEN
    CREATE POLICY "Authenticated users can upload forum attachments"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'forum-attachments');
  END IF;
END $$;

-- RLS: Todos podem visualizar anexos
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public can view forum attachments'
  ) THEN
    CREATE POLICY "Public can view forum attachments"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'forum-attachments');
  END IF;
END $$;

-- RLS: Autor pode deletar seus anexos
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Authors can delete their attachments'
  ) THEN
    CREATE POLICY "Authors can delete their attachments"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'forum-attachments' AND
      owner = (select auth.uid())
    );
  END IF;
END $$;

-- Criar tabela de metadados de anexos
CREATE TABLE IF NOT EXISTS public.forum_attachment_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  original_filename TEXT NOT NULL,
  
  -- Metadados de imagem (EXIF)
  image_width INTEGER,
  image_height INTEGER,
  gps_latitude DECIMAL(10, 8),
  gps_longitude DECIMAL(11, 8),
  capture_date TIMESTAMPTZ,
  device_make TEXT,
  device_model TEXT,
  
  -- Metadados de áudio
  audio_duration_seconds INTEGER,
  
  -- Placeholders para futuras integrações com APIs externas
  transcription TEXT,
  ocr_text TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_attachment_post ON public.forum_attachment_metadata(post_id);
CREATE INDEX IF NOT EXISTS idx_attachment_location ON public.forum_attachment_metadata(gps_latitude, gps_longitude) 
  WHERE gps_latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachment_type ON public.forum_attachment_metadata(file_type);

-- RLS: Todos podem visualizar metadados de anexos
ALTER TABLE public.forum_attachment_metadata ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='forum_attachment_metadata' AND policyname='Anyone can view attachment metadata'
  ) THEN
    CREATE POLICY "Anyone can view attachment metadata"
    ON public.forum_attachment_metadata FOR SELECT
    TO public
    USING (true);
  END IF;
END $$;

-- RLS: Sistema pode inserir metadados
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='forum_attachment_metadata' AND policyname='Authenticated users can insert attachment metadata'
  ) THEN
    CREATE POLICY "Authenticated users can insert attachment metadata"
    ON public.forum_attachment_metadata FOR INSERT
    TO authenticated
    WITH CHECK (true);
  END IF;
END $$;
