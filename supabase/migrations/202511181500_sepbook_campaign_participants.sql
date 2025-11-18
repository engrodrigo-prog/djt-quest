-- SEPBook: vínculo com campanhas e participantes

alter table if exists public.campaigns
  add column if not exists is_team_campaign boolean not null default false;

comment on column public.campaigns.is_team_campaign is 'Indica se a campanha é pensada para execução em equipe (evidências em grupo, XP compartilhado).';

alter table if exists public.sepbook_posts
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

create table if not exists public.sepbook_post_participants (
  post_id uuid not null references public.sepbook_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

