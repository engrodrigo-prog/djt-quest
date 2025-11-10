-- Create evidence bucket and basic policies
insert into storage.buckets (id, name, public)
values ('evidence','evidence', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Evidence public read'
  ) then
    create policy "Evidence public read" on storage.objects
      for select using (bucket_id = 'evidence');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Evidence authenticated write'
  ) then
    create policy "Evidence authenticated write" on storage.objects
      for insert to authenticated with check (bucket_id = 'evidence');
  end if;
end $$;

