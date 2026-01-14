-- Restore evidence columns on events (idempotent)
alter table public.events
  add column if not exists evidence_urls text[];

alter table public.events
  add column if not exists quality_score numeric(3,2),
  add column if not exists severity_weight numeric(3,2);

do $$
begin
  update public.events
     set evidence_urls = (
       select array_agg(value::text)
       from jsonb_array_elements_text(
         case
           when jsonb_typeof(payload->'attachments') = 'array' then payload->'attachments'
           when jsonb_typeof(payload->'evidence_urls') = 'array' then payload->'evidence_urls'
           else '[]'::jsonb
         end
       )
     )
   where evidence_urls is null
     and (
       jsonb_typeof(payload->'attachments') = 'array'
       or jsonb_typeof(payload->'evidence_urls') = 'array'
     );
exception
  when undefined_column then
    -- Schema drift; skip backfill.
    null;
end $$;

