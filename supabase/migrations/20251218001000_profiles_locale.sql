-- i18n: persist user locale preference (fallback pt-BR)

alter table if exists public.profiles
  add column if not exists locale text;

-- Backfill defensively
update public.profiles
set locale = 'pt-BR'
where locale is null or btrim(locale) = '';

alter table if exists public.profiles
  alter column locale set default 'pt-BR';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_locale_check') then
    alter table public.profiles
      add constraint profiles_locale_check
      check (locale in ('pt-BR','en','zh-CN'));
  end if;
end $$;

