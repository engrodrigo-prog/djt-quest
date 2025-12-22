-- SEPBook XP cap: at most 100 XP per user per month from SEPBook-only interactions
create table if not exists public.sepbook_xp_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  created_at timestamptz not null default now()
);

create or replace function public.increment_sepbook_profile_xp(p_user_id uuid, p_amount integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  month_start timestamptz;
  month_end timestamptz;
  used integer;
  to_add integer;
begin
  if p_user_id is null then
    return;
  end if;

  -- Normalizar valor (apenas créditos positivos contam para o limite)
  to_add := greatest(coalesce(p_amount, 0), 0);
  if to_add <= 0 then
    return;
  end if;

  month_start := date_trunc('month', now());
  month_end := (date_trunc('month', now()) + interval '1 month');

  select coalesce(sum(amount), 0)
    into used
  from public.sepbook_xp_log
  where user_id = p_user_id
    and created_at >= month_start
    and created_at < month_end;

  if used >= 100 then
    -- Já atingiu o limite mensal de 100 XP via SEPBook
    return;
  end if;

  if used + to_add > 100 then
    to_add := 100 - used;
  end if;

  if to_add <= 0 then
    return;
  end if;

  update public.profiles
     set xp = coalesce(xp, 0) + to_add
   where id = p_user_id;

  insert into public.sepbook_xp_log(user_id, amount)
  values (p_user_id, to_add);
end;
$$;
