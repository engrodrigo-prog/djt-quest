alter table if exists public.quiz_attempts
  add column if not exists help_used boolean not null default false;

comment on column public.quiz_attempts.help_used is 'Indica se o usuário utilizou alguma ajuda (Burini, pular, eliminar alternativas) nesta tentativa.';

