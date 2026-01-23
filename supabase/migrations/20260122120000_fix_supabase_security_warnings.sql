-- Fix Supabase security advisor warnings (vector extension, function search_path, finance_requests update policy).

create schema if not exists extensions;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    if exists (
      select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'vector' and n.nspname = 'public'
    ) then
      alter extension vector set schema extensions;
    end if;
  else
    create extension if not exists vector with schema extensions;
  end if;
end $$;

do $$
begin
  perform set_config('search_path', 'extensions, public', false);
  if to_regprocedure('public.match_study_source_chunks(vector, integer, double precision)') is not null then
    execute 'alter function public.match_study_source_chunks(vector, integer, double precision) set search_path = public, extensions, pg_temp';
  end if;
end $$;

drop policy if exists "FinanceRequests: update owner cancel or staff" on public.finance_requests;
create policy "FinanceRequests: update owner cancel or staff"
on public.finance_requests for update
to authenticated
using (
  created_by = (select auth.uid())
  or public.has_role((select auth.uid()), 'admin')
  or public.has_role((select auth.uid()), 'gerente_djt')
  or public.has_role((select auth.uid()), 'gerente_divisao_djtx')
  or public.has_role((select auth.uid()), 'coordenador_djtx')
  or public.has_role((select auth.uid()), 'lider_equipe')
  or public.has_role((select auth.uid()), 'analista_financeiro')
)
with check (
  created_by = (select auth.uid())
  or public.has_role((select auth.uid()), 'admin')
  or public.has_role((select auth.uid()), 'gerente_djt')
  or public.has_role((select auth.uid()), 'gerente_divisao_djtx')
  or public.has_role((select auth.uid()), 'coordenador_djtx')
  or public.has_role((select auth.uid()), 'lider_equipe')
  or public.has_role((select auth.uid()), 'analista_financeiro')
);
