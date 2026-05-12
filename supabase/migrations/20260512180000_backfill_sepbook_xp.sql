-- Backfill: recalcular XP de engajamento do SEPBook
--
-- Regras novas (a partir de 2026-05-12):
--   publicação  → 30 XP base + 5 XP por foto (campo attachments)
--   comentário  → 5 XP
--
-- Antes: publicação ganhava 0 XP base (apenas fotos × 5); comentário ganhava 2 XP.
-- Delta a creditar por post  = 30 + fotos × 5 - fotos × 5 (antigo) = 30 XP
-- Delta a creditar por comment = 5 - 2 = 3 XP
--
-- Para evitar duplo crédito em backfills futuros, o crédito é aplicado como
-- transação idempotente: só incrementa se ainda não existir linha em
-- sepbook_xp_backfill_log para o item em questão.

create table if not exists public.sepbook_xp_backfill_log (
  id          uuid primary key default gen_random_uuid(),
  ref_type    text not null, -- 'post' | 'comment'
  ref_id      uuid not null,
  user_id     uuid not null,
  xp_credited int  not null,
  credited_at timestamptz not null default now(),
  unique (ref_type, ref_id)
);

alter table public.sepbook_xp_backfill_log enable row level security;
grant all on public.sepbook_xp_backfill_log to service_role;

do $$
declare
  r record;
begin
  -- ── Posts: +30 XP por publicação ──────────────────────────────────────────
  for r in
    select p.id, p.user_id
    from public.sepbook_posts p
    where p.user_id is not null
      and not exists (
        select 1 from public.sepbook_xp_backfill_log l
        where l.ref_type = 'post' and l.ref_id = p.id
      )
  loop
    begin
      perform public.increment_user_xp(r.user_id, 30);
      insert into public.sepbook_xp_backfill_log (ref_type, ref_id, user_id, xp_credited)
      values ('post', r.id, r.user_id, 30);
    exception when others then
      -- best-effort; silently skip on error
    end;
  end loop;

  -- ── Comments: +3 XP (diferença de 5-2) ────────────────────────────────────
  for r in
    select c.id, c.user_id
    from public.sepbook_comments c
    where c.user_id is not null
      and not exists (
        select 1 from public.sepbook_xp_backfill_log l
        where l.ref_type = 'comment' and l.ref_id = c.id
      )
  loop
    begin
      perform public.increment_user_xp(r.user_id, 3);
      insert into public.sepbook_xp_backfill_log (ref_type, ref_id, user_id, xp_credited)
      values ('comment', r.id, r.user_id, 3);
    exception when others then
      -- best-effort; silently skip on error
    end;
  end loop;
end;
$$;
