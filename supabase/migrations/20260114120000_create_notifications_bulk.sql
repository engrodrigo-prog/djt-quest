-- Notifications: bulk insert helper for team mentions and high-fanout events

create or replace function public.create_notifications_bulk(
  _user_ids uuid[],
  _type text,
  _title text,
  _message text,
  _metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.notifications (user_id, type, title, message, metadata)
  select distinct u, _type, _title, _message, coalesce(_metadata, '{}'::jsonb)
  from unnest(coalesce(_user_ids, array[]::uuid[])) as u
  where u is not null;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

grant execute on function public.create_notifications_bulk(uuid[], text, text, text, jsonb) to authenticated, service_role;

