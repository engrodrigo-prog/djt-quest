-- Align challenge RLS policies to new role literals used across the app
-- Replace legacy roles ('gerente','lider_divisao','coordenador') with
-- ('gerente_djt','gerente_divisao_djtx','coordenador_djtx')

do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='challenges' and policyname='Admins and leaders can create challenges') then
    drop policy "Admins and leaders can create challenges" on public.challenges;
  end if;
  create policy "Admins and leaders can create challenges"
    on public.challenges for insert
    to authenticated
    with check (
      public.has_role((select auth.uid()), 'admin') OR 
      public.has_role((select auth.uid()), 'gerente_djt') OR
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') OR
      public.has_role((select auth.uid()), 'coordenador_djtx')
    );
end $$;

do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='challenges' and policyname='Admins and leaders can update challenges') then
    drop policy "Admins and leaders can update challenges" on public.challenges;
  end if;
  create policy "Admins and leaders can update challenges"
    on public.challenges for update
    to authenticated
    using (
      public.has_role((select auth.uid()), 'admin') OR 
      public.has_role((select auth.uid()), 'gerente_djt') OR
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') OR
      public.has_role((select auth.uid()), 'coordenador_djtx')
    );
end $$;

do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='challenges' and policyname='Admins and leaders can delete challenges') then
    drop policy "Admins and leaders can delete challenges" on public.challenges;
  end if;
  create policy "Admins and leaders can delete challenges"
    on public.challenges for delete
    to authenticated
    using (
      public.has_role((select auth.uid()), 'admin') OR 
      public.has_role((select auth.uid()), 'gerente_djt') OR
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') OR
      public.has_role((select auth.uid()), 'coordenador_djtx')
    );
end $$;

