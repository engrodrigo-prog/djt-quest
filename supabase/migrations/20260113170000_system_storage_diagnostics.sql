-- System diagnostics: DB size + storage usage breakdown (images/audio/video/docs).

create or replace function public.system_storage_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  db_bytes bigint := 0;
  storage_total bigint := 0;
  by_bucket jsonb := '[]'::jsonb;
  by_kind jsonb := '[]'::jsonb;
  top_tables jsonb := '[]'::jsonb;
begin
  begin
    select pg_database_size(current_database()) into db_bytes;
  exception when others then
    db_bytes := 0;
  end;

  begin
    with objs as (
      select
        bucket_id,
        name,
        coalesce((metadata->>'size')::bigint, 0) as size_bytes,
        lower(coalesce(metadata->>'mimetype', '')) as mimetype
      from storage.objects
    ),
    typed as (
      select
        bucket_id,
        size_bytes,
        case
          when mimetype like 'image/%' then 'images'
          when mimetype like 'audio/%' then 'audio'
          when mimetype like 'video/%' then 'video'
          when mimetype in (
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain'
          ) then 'docs'
          when name ~* '\\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$' then 'docs'
          when name ~* '\\.(jpg|jpeg|png|webp|gif)$' then 'images'
          when name ~* '\\.(mp3|wav|m4a|aac|ogg|opus)$' then 'audio'
          when name ~* '\\.(mp4|mov|webm)$' then 'video'
          else 'other'
        end as kind
      from objs
    )
    select coalesce(sum(size_bytes), 0) into storage_total from typed;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('bucket_id', bucket_id, 'bytes', bytes, 'files', files)
        order by bytes desc
      ),
      '[]'::jsonb
    )
    into by_bucket
    from (
      select bucket_id, sum(size_bytes) as bytes, count(*) as files
      from typed
      group by bucket_id
    ) b;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('kind', kind, 'bytes', bytes, 'files', files)
        order by bytes desc
      ),
      '[]'::jsonb
    )
    into by_kind
    from (
      select kind, sum(size_bytes) as bytes, count(*) as files
      from typed
      group by kind
    ) k;
  exception when others then
    storage_total := 0;
    by_bucket := '[]'::jsonb;
    by_kind := '[]'::jsonb;
  end;

  begin
    select coalesce(
      jsonb_agg(
        jsonb_build_object('name', name, 'bytes', bytes)
        order by bytes desc
      ),
      '[]'::jsonb
    )
    into top_tables
    from (
      select
        c.relname as name,
        pg_total_relation_size(c.oid) as bytes
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc
      limit 25
    ) t;
  exception when others then
    top_tables := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'generated_at', now(),
    'db', jsonb_build_object('bytes', db_bytes),
    'storage', jsonb_build_object(
      'total_bytes', storage_total,
      'by_bucket', by_bucket,
      'by_kind', by_kind
    ),
    'public_tables_top', top_tables
  );
end;
$$;

revoke all on function public.system_storage_diagnostics() from public;
grant execute on function public.system_storage_diagnostics() to service_role;
