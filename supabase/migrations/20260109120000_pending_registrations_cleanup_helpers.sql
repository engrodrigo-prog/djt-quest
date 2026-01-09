-- Helpers to cleanup pending_registrations history (cache) safely.

create or replace function public.delete_pending_registrations_by_emails(p_emails text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_emails is null or array_length(p_emails, 1) is null then
    return 0;
  end if;

  delete from public.pending_registrations pr
  where lower(pr.email) = any (
    select lower(btrim(e))
    from unnest(p_emails) as e
    where e is not null and btrim(e) <> ''
  );

  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

create or replace function public.cleanup_pending_registrations_orphan_approved(p_dry_run boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  select count(*)
  into n
  from public.pending_registrations pr
  where pr.status = 'approved'
    and not exists (
      select 1 from public.profiles p
      where p.email is not null
        and lower(p.email) = lower(pr.email)
    );

  if coalesce(p_dry_run, true) then
    return coalesce(n, 0);
  end if;

  delete from public.pending_registrations pr
  where pr.status = 'approved'
    and not exists (
      select 1 from public.profiles p
      where p.email is not null
        and lower(p.email) = lower(pr.email)
    );

  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

