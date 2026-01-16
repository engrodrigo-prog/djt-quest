-- Allow request owners to insert the initial "Enviado" status history row.
-- This keeps auditing consistent even when the API uses the user's JWT (no service role).

drop policy if exists "FinanceStatusHistory: insert initial by owner" on public.finance_request_status_history;
create policy "FinanceStatusHistory: insert initial by owner"
on public.finance_request_status_history for insert
to authenticated
with check (
  changed_by = (select auth.uid())
  and from_status is null
  and to_status = 'Enviado'
  and exists (
    select 1
    from public.finance_requests fr
    where fr.id = finance_request_status_history.request_id
      and fr.created_by = (select auth.uid())
  )
);

