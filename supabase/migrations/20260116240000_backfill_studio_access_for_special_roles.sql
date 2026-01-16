-- Ensure users with special studio-limited roles can see the Studio entrypoint.
-- This is a conservative backfill (no role changes).

update public.profiles
set studio_access = true
where coalesce(studio_access, false) = false
  and id in (
    select distinct user_id
    from public.user_roles
    where role in ('analista_financeiro', 'content_curator')
  );

