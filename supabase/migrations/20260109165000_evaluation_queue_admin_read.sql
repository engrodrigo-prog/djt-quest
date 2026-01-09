-- Allow admins to view evaluation_queue

drop policy if exists "Leaders can view evaluation queue" on public.evaluation_queue;
create policy "Leaders can view evaluation queue" on public.evaluation_queue
  as permissive for select to authenticated
  using (
    has_role((select auth.uid()), 'coordenador_djtx'::text) OR
    has_role((select auth.uid()), 'gerente_divisao_djtx'::text) OR
    has_role((select auth.uid()), 'gerente_djt'::text) OR
    has_role((select auth.uid()), 'admin'::text)
  );

