-- Fix: increment_user_xp should work even when profiles.xp is NULL.
-- This also prevents NULL tiers from blocking tier updates for affected users.

create or replace function public.increment_user_xp(_user_id uuid, _xp_to_add integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.profiles
     set xp = coalesce(xp, 0) + coalesce(_xp_to_add, 0),
         tier = public.calculate_tier_from_xp(coalesce(xp, 0) + coalesce(_xp_to_add, 0), tier),
         updated_at = now()
   where id = _user_id;
end;
$$;

-- Backfill: normalize existing NULL xp to 0 so future arithmetic and UI are consistent.
update public.profiles
   set xp = 0,
       updated_at = now()
 where xp is null;
