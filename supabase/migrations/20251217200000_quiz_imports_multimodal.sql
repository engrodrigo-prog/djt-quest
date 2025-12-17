-- Expand quiz-imports bucket MIME allowlist for multimodal imports (quizzes + compêndio)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quiz-imports',
  'quiz-imports',
  false,
  52428800,
  array[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
    'text/plain',
    'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

