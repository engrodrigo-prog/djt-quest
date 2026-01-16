-- Fix finance protocol generator: Supabase extensions live in `extensions` schema.
-- Our previous function used `gen_random_bytes()` with `search_path = public`,
-- causing: "function gen_random_bytes(integer) does not exist".

create or replace function public.generate_finance_protocol()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stamp text;
  rand text;
begin
  stamp := to_char(now(), 'YYYYMMDD-HH24MISS');
  rand := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 4));
  return format('FIN-%s-%s', stamp, rand);
end;
$$;

