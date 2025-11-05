-- Update quiz policies to allow leaders/studio access users
drop policy if exists "Coordinators can create questions" on public.quiz_questions;
drop policy if exists "Coordinators can update questions" on public.quiz_questions;
drop policy if exists "Coordinators can delete questions" on public.quiz_questions;

drop policy if exists "Coordinators can insert options" on public.quiz_options;
drop policy if exists "Coordinators can update options" on public.quiz_options;
drop policy if exists "Coordinators can delete options" on public.quiz_options;

create policy "Studio can create questions"
  on public.quiz_questions for insert
  to authenticated
  with check (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt') OR
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
    )
  );

create policy "Studio can update questions"
  on public.quiz_questions for update
  to authenticated
  using (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt') OR
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
    )
  );

create policy "Studio can delete questions"
  on public.quiz_questions for delete
  to authenticated
  using (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt') OR
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
    )
  );

create policy "Studio can insert options"
  on public.quiz_options for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.quiz_questions qq
      where qq.id = quiz_options.question_id
        and (
          has_role(auth.uid(), 'coordenador_djtx') OR
          has_role(auth.uid(), 'gerente_divisao_djtx') OR
          has_role(auth.uid(), 'gerente_djt') OR
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
          )
        )
    )
  );

create policy "Studio can update options"
  on public.quiz_options for update
  to authenticated
  using (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt') OR
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
    )
  );

create policy "Studio can delete options"
  on public.quiz_options for delete
  to authenticated
  using (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt') OR
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
    )
  );

create policy "Studio can delete questions"
  on public.quiz_questions for delete
  to authenticated
  using (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt') OR
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
    )
  );

create policy "Studio can insert options"
  on public.quiz_options for insert
  to authenticated
  with check (
    exists (
      select 1 from public.quiz_questions qq
      where qq.id = quiz_options.question_id
        and (
          has_role(auth.uid(), 'coordenador_djtx') OR
          has_role(auth.uid(), 'gerente_divisao_djtx') OR
          has_role(auth.uid(), 'gerente_djt') OR
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
          )
        )
    )
  );

create policy "Studio can update options"
  on public.quiz_options for update
  to authenticated
  using (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt') OR
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
    )
  );

create policy "Studio can delete options"
  on public.quiz_options for delete
  to authenticated
  using (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt') OR
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (coalesce(p.is_leader, false) OR coalesce(p.studio_access, false))
    )
  );
