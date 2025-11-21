-- Enriquecer SEPBook para associar campanhas/desafios e participantes

alter table if exists public.sepbook_posts
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null,
  add column if not exists challenge_id uuid references public.challenges(id) on delete set null,
  add column if not exists group_label text;

-- Reforço: tabela de participantes já criada em 202511181500, manter idempotente
create table if not exists public.sepbook_post_participants (
  post_id uuid not null references public.sepbook_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
