-- Finance requests: allow owner hard-delete only while request is still initial and unseen by analyst.

alter table public.finance_requests
  add column if not exists analyst_viewed_at timestamptz;

drop policy if exists "FinanceRequests: delete owner initial unseen" on public.finance_requests;
create policy "FinanceRequests: delete owner initial unseen"
on public.finance_requests for delete
to authenticated
using (
  created_by = (select auth.uid())
  and status = 'Enviado'
  and analyst_viewed_at is null
);
