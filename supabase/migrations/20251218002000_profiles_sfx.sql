-- SFX: persist user sound preferences (toggle + volume)

alter table if exists public.profiles
  add column if not exists sfx_muted boolean;

alter table if exists public.profiles
  add column if not exists sfx_volume real;

-- Backfill defaults defensively
update public.profiles
set sfx_muted = false
where sfx_muted is null;

update public.profiles
set sfx_volume = 0.6
where sfx_volume is null;

alter table if exists public.profiles
  alter column sfx_muted set default false;

alter table if exists public.profiles
  alter column sfx_volume set default 0.6;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_sfx_volume_check') then
    alter table public.profiles
      add constraint profiles_sfx_volume_check
      check (sfx_volume >= 0 and sfx_volume <= 1);
  end if;
end $$;

