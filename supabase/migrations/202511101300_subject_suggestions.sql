-- Subject suggestions for themes/subthemes + auto-upsert from challenges
create table if not exists public.subject_suggestions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('theme','subtheme')),
  value text not null,
  used_count integer not null default 1,
  last_used timestamptz not null default now(),
  unique(kind, value)
);

alter table public.subject_suggestions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='subject_suggestions' and policyname='SubjectSuggestions: read'
  ) then
    create policy "SubjectSuggestions: read" on public.subject_suggestions for select using (true);
  end if;
end $$;

create or replace function public.upsert_subject_suggestion(_kind text, _value text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if _value is null or length(trim(_value)) = 0 then
    return;
  end if;
  insert into public.subject_suggestions(kind, value, used_count, last_used)
  values (_kind, trim(_value), 1, now())
  on conflict (kind, value) do update
    set used_count = public.subject_suggestions.used_count + 1,
        last_used = now();
end;
$$;

create or replace function public.on_challenge_upsert_subjects()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.upsert_subject_suggestion('theme', new.theme);
  perform public.upsert_subject_suggestion('subtheme', new.subtheme);
  return new;
end;
$$;

do $$ begin
  if exists (
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where t.tgname='trg_challenges_subjects' and n.nspname='public' and c.relname='challenges'
  ) then
    drop trigger trg_challenges_subjects on public.challenges;
  end if;
end $$;

create trigger trg_challenges_subjects
after insert or update on public.challenges
for each row execute function public.on_challenge_upsert_subjects();

