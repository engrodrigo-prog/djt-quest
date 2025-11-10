-- Allow multiple assignments per event by using a composite unique key
do $$ begin
  begin
    alter table public.evaluation_queue drop constraint if exists evaluation_queue_event_id_key;
  exception when others then null; end;
end $$;

-- Drop any simple unique index on (event_id)
do $$ begin
  perform 1 from pg_indexes where schemaname='public' and tablename='evaluation_queue' and indexname='evaluation_queue_event_id_idx';
  if found then
    execute 'drop index if exists public.evaluation_queue_event_id_idx';
  end if;
exception when others then null; end $$;

-- Create composite unique index for (event_id, assigned_to) when assigned_to is not null
create unique index if not exists idx_evaluation_queue_event_assignee
on public.evaluation_queue (event_id, assigned_to)
where assigned_to is not null;

