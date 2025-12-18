-- TTS: persist user voice preferences (enabled + voice gender + rate + volume)

alter table if exists public.profiles
  add column if not exists tts_enabled boolean;

alter table if exists public.profiles
  add column if not exists tts_voice_gender text;

alter table if exists public.profiles
  add column if not exists tts_rate real;

alter table if exists public.profiles
  add column if not exists tts_volume real;

-- Backfill defaults defensively
update public.profiles
set tts_enabled = false
where tts_enabled is null;

update public.profiles
set tts_voice_gender = 'male'
where tts_voice_gender is null or btrim(tts_voice_gender) = '';

update public.profiles
set tts_rate = 1
where tts_rate is null;

update public.profiles
set tts_volume = 1
where tts_volume is null;

alter table if exists public.profiles
  alter column tts_enabled set default false;

alter table if exists public.profiles
  alter column tts_voice_gender set default 'male';

alter table if exists public.profiles
  alter column tts_rate set default 1;

alter table if exists public.profiles
  alter column tts_volume set default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_tts_voice_gender_check') then
    alter table public.profiles
      add constraint profiles_tts_voice_gender_check
      check (tts_voice_gender in ('male','female'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_tts_rate_check') then
    alter table public.profiles
      add constraint profiles_tts_rate_check
      check (tts_rate >= 0.25 and tts_rate <= 2);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_tts_volume_check') then
    alter table public.profiles
      add constraint profiles_tts_volume_check
      check (tts_volume >= 0 and tts_volume <= 1);
  end if;
end $$;

