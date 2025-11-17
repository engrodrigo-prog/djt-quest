create table if not exists public.content_change_requests (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('campaign','challenge','quiz','forum_topic')),
  item_id uuid not null,
  action text not null check (action in ('update','delete')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'pending', -- pending, approved, rejected, auto_approved
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  payload_before jsonb,
  payload_after jsonb
);

alter table public.content_change_requests enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' 
      and tablename = 'content_change_requests' 
      and policyname = 'ContentChanges: insert own'
  ) then
    create policy "ContentChanges: insert own"
      on public.content_change_requests
      for insert
      to authenticated
      with check (requested_by = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' 
      and tablename = 'content_change_requests' 
      and policyname = 'ContentChanges: staff read'
  ) then
    create policy "ContentChanges: staff read"
      on public.content_change_requests
      for select
      to authenticated
      using (
        public.is_staff(auth.uid())
      );
  end if;
end $$;

