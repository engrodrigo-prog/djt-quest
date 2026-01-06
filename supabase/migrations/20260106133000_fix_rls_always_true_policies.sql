-- Fix Supabase linter: rls_policy_always_true

-- forum_attachment_metadata: allow authenticated inserts only for attachments linked to own post
drop policy if exists "Authenticated users can insert attachment metadata" on public.forum_attachment_metadata;
create policy "Authenticated users can insert attachment metadata"
  on public.forum_attachment_metadata
  for insert
  to authenticated
  with check (
    post_id is not null
    and storage_path is not null
    and length(trim(storage_path)) > 0
    and exists (
      select 1
      from public.forum_posts p
      where p.id = post_id
        and ((p.user_id = (select auth.uid())) or (p.author_id = (select auth.uid())))
    )
  );

-- pending_registrations: still public insert, but require minimum valid fields (no WITH CHECK (true))
drop policy if exists "Anyone can register" on public.pending_registrations;
drop policy if exists "Pending: anyone insert" on public.pending_registrations;
create policy "Anyone can register"
  on public.pending_registrations
  for insert
  to public
  with check (
    status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and name is not null
    and length(trim(name)) >= 3
    and email is not null
    and email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
    and operational_base is not null
    and length(trim(operational_base)) >= 2
    and sigla_area is not null
    and length(trim(sigla_area)) >= 2
  );

