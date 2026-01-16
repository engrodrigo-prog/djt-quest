-- SEPBook: classify posts as "normal" or "ocorrencia"
-- Default must be "normal" and filtering is optional on client.

alter table if exists public.sepbook_posts
  add column if not exists post_kind text not null default 'normal';

-- Keep values constrained (idempotent)
alter table if exists public.sepbook_posts
  drop constraint if exists sepbook_posts_post_kind_check;

alter table if exists public.sepbook_posts
  add constraint sepbook_posts_post_kind_check
  check (post_kind in ('normal', 'ocorrencia'));

create index if not exists idx_sepbook_posts_post_kind on public.sepbook_posts (post_kind);

