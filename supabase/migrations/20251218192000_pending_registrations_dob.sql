-- Registration: capture date of birth at signup (pending_registrations -> profiles.date_of_birth)

alter table public.pending_registrations
  add column if not exists date_of_birth date;

comment on column public.pending_registrations.date_of_birth is
  'User-provided date of birth at signup (copied to profiles.date_of_birth on approval).';

