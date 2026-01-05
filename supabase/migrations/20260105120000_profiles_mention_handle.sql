-- Profiles: add a stable @mention handle based on "first.last" (name + last surname)
-- Example: "João da Silva" -> "joao.silva"
-- If duplicates exist, we append a numeric suffix: "joao.silva.2"

create extension if not exists unaccent;

alter table if exists public.profiles
  add column if not exists mention_handle text;

create unique index if not exists idx_profiles_mention_handle_unique
on public.profiles (mention_handle)
where mention_handle is not null;

-- Base handle (non-unique): first.last (lower + unaccent + [a-z0-9] only)
create or replace function public.slugify_mention_handle(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
  parts text[];
  first text;
  last text;
begin
  cleaned := lower(unaccent(coalesce(p_name, '')));
  cleaned := regexp_replace(cleaned, '[^a-z0-9\\s-]+', ' ', 'g');
  cleaned := regexp_replace(cleaned, '\\s+', ' ', 'g');
  cleaned := trim(cleaned);
  if cleaned is null or cleaned = '' then
    return null;
  end if;

  parts := string_to_array(cleaned, ' ');
  first := parts[1];
  last := parts[array_length(parts, 1)];
  if first is null or first = '' then
    return null;
  end if;
  if last is null or last = '' then
    last := first;
  end if;

  if last = first then
    return first;
  end if;
  return first || '.' || last;
end;
$$;

-- Unique handle (collision-safe): base, base.2, base.3, ...
create or replace function public.generate_unique_mention_handle(p_name text, p_user_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n int := 1;
begin
  base := public.slugify_mention_handle(p_name);
  if base is null or base = '' then
    return null;
  end if;

  candidate := base;
  loop
    perform 1
    from public.profiles p
    where p.mention_handle = candidate
      and (p_user_id is null or p.id <> p_user_id);

    if not found then
      return candidate;
    end if;

    n := n + 1;
    candidate := base || '.' || n::text;

    if n > 50 then
      -- hard fallback (still deterministic-ish)
      candidate := base || '.' || substring(coalesce(p_user_id::text, '0000') from 1 for 4);
      return candidate;
    end if;
  end loop;
end;
$$;

create or replace function public.trg_profiles_set_mention_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.mention_handle is null or trim(new.mention_handle) = '' then
      new.mention_handle := public.generate_unique_mention_handle(new.name, new.id);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      new.mention_handle := public.generate_unique_mention_handle(new.name, new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_set_mention_handle on public.profiles;
create trigger trg_profiles_set_mention_handle
before insert or update of name on public.profiles
for each row
execute function public.trg_profiles_set_mention_handle();

-- Backfill existing profiles (safe)
do $$
declare
  r record;
begin
  for r in select id, name from public.profiles where mention_handle is null loop
    update public.profiles
      set mention_handle = public.generate_unique_mention_handle(r.name, r.id)
      where id = r.id;
  end loop;
end $$;

