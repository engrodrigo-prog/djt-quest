-- Finance Requests: simplify statuses and normalize casing.

-- 1) Drop the old CHECK constraint first (it would reject the new casing).
alter table public.finance_requests
  drop constraint if exists finance_requests_status_check;
-- 2) Normalize existing data first (so the new CHECK constraint can be applied).
update public.finance_requests
set status = 'Aprovado'
where status = 'Pago';
update public.finance_requests
set status = 'Em Análise'
where status = 'Em análise';
update public.finance_request_status_history
set from_status = 'Aprovado'
where from_status = 'Pago';
update public.finance_request_status_history
set to_status = 'Aprovado'
where to_status = 'Pago';
update public.finance_request_status_history
set from_status = 'Em Análise'
where from_status = 'Em análise';
update public.finance_request_status_history
set to_status = 'Em Análise'
where to_status = 'Em análise';
-- 3) Update the allowed statuses.
alter table public.finance_requests
  add constraint finance_requests_status_check
  check (status in ('Enviado','Em Análise','Aprovado','Reprovado','Cancelado'));
