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
);

-- RLS: Usuários autenticados podem fazer upload
CREATE POLICY "Authenticated users can upload forum attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'forum-attachments');

-- RLS: Todos podem visualizar anexos
CREATE POLICY "Public can view forum attachments"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'forum-attachments');

-- RLS: Autor pode deletar seus anexos
CREATE POLICY "Authors can delete their attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'forum-attachments' AND
  owner = auth.uid()
);

-- Criar tabela de metadados de anexos
CREATE TABLE forum_attachment_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
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
CREATE INDEX idx_attachment_post ON forum_attachment_metadata(post_id);
CREATE INDEX idx_attachment_location ON forum_attachment_metadata(gps_latitude, gps_longitude) 
  WHERE gps_latitude IS NOT NULL;
CREATE INDEX idx_attachment_type ON forum_attachment_metadata(file_type);

-- RLS: Todos podem visualizar metadados de anexos
CREATE POLICY "Anyone can view attachment metadata"
ON forum_attachment_metadata FOR SELECT
TO public
USING (true);

-- RLS: Sistema pode inserir metadados
CREATE POLICY "Authenticated users can insert attachment metadata"
ON forum_attachment_metadata FOR INSERT
TO authenticated
WITH CHECK (true);