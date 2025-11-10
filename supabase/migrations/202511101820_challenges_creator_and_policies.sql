-- Add created_by to challenges and restrict update/delete
alter table if exists public.challenges
  add column if not exists created_by uuid;

-- Ensure RLS helper exists
create or replace function public.set_challenge_creator()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;$$;

drop trigger if exists trg_set_challenge_creator on public.challenges;
create trigger trg_set_challenge_creator
before insert on public.challenges
for each row execute function public.set_challenge_creator();

-- Tighten update/delete policies: creator or higher hierarchy (coordinator/manager/admin)
do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='challenges' and policyname='Admins and leaders can update challenges') then
    drop policy "Admins and leaders can update challenges" on public.challenges;
  end if;
  create policy "Challenges: creator or hierarchy update"
    on public.challenges for update to authenticated
    using (
      (created_by = (select auth.uid())) OR
      public.has_role((select auth.uid()), 'admin') OR
      public.has_role((select auth.uid()), 'gerente_djt') OR
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') OR
      public.has_role((select auth.uid()), 'coordenador_djtx')
    );

  if exists (select 1 from pg_policies where schemaname='public' and tablename='challenges' and policyname='Admins and leaders can delete challenges') then
    drop policy "Admins and leaders can delete challenges" on public.challenges;
  end if;
  create policy "Challenges: creator or hierarchy delete"
    on public.challenges for delete to authenticated
    using (
      (created_by = (select auth.uid())) OR
      public.has_role((select auth.uid()), 'admin') OR
      public.has_role((select auth.uid()), 'gerente_djt') OR
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') OR
      public.has_role((select auth.uid()), 'coordenador_djtx')
    );
end $$;

