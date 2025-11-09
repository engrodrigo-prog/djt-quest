alter table public.profiles
  add column if not exists date_of_birth date;

create index if not exists idx_profiles_date_of_birth
  on public.profiles(date_of_birth);
