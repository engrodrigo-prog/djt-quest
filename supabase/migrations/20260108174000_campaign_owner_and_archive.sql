-- Campaign ownership + soft archive (avoid destructive deletes).

alter table if exists public.campaigns
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists archived_at timestamptz;

create index if not exists idx_campaigns_created_by on public.campaigns(created_by);
create index if not exists idx_campaigns_archived_at on public.campaigns(archived_at);

-- RLS: creator or staff can view/edit; delete disabled (use archived_at instead).
alter table if exists public.campaigns enable row level security;

drop policy if exists "Admins and gerentes can manage campaigns" on public.campaigns;
drop policy if exists "All can view active campaigns" on public.campaigns;
drop policy if exists "Campaigns: admin insert" on public.campaigns;
drop policy if exists "Campaigns: admin update" on public.campaigns;
drop policy if exists "Campaigns: admin delete" on public.campaigns;

create policy "Campaigns: view"
  on public.campaigns
  for select
  to authenticated
  using (
    (archived_at is null and is_active = true)
    or public.is_staff((select auth.uid()))
    or created_by = (select auth.uid())
  );

create policy "Campaigns: insert"
  on public.campaigns
  for insert
  to authenticated
  with check (
    public.is_staff((select auth.uid()))
    or created_by = (select auth.uid())
  );

create policy "Campaigns: update"
  on public.campaigns
  for update
  to authenticated
  using (
    public.is_staff((select auth.uid()))
    or created_by = (select auth.uid())
  )
  with check (
    public.is_staff((select auth.uid()))
    or created_by = (select auth.uid())
  );

