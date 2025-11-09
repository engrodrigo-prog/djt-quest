-- Update quiz policies to allow leaders/studio access users
drop policy if exists "Coordinators can create questions" on public.quiz_questions;
drop policy if exists "Coordinators can update questions" on public.quiz_questions;
drop policy if exists "Coordinators can delete questions" on public.quiz_questions;

drop policy if exists "Coordinators can insert options" on public.quiz_options;
drop policy if exists "Coordinators can update options" on public.quiz_options;
drop policy if exists "Coordinators can delete options" on public.quiz_options;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_questions' and policyname='Studio can create questions'
  ) then
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
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_questions' and policyname='Studio can update questions'
  ) then
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
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_questions' and policyname='Studio can delete questions'
  ) then
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
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_options' and policyname='Studio can insert options'
  ) then
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
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_options' and policyname='Studio can update options'
  ) then
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
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_options' and policyname='Studio can delete options'
  ) then
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
  end if;
end $$;

-- duplicates protection (legacy block repeated)
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_questions' and policyname='Studio can delete questions'
  ) then
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
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_options' and policyname='Studio can insert options'
  ) then
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
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_options' and policyname='Studio can update options'
  ) then
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
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='quiz_options' and policyname='Studio can delete options'
  ) then
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
  end if;
end $$;
