-- Campaign linking and evidence workflow
-- - Allow linking forum topics to campaigns
-- - Persist event_id on SEPBook posts when they spawn an evidence event
-- - Create an automatic "evidence" challenge per campaign (A) so events always have challenge_id

alter table if exists public.campaigns
  add column if not exists evidence_challenge_id uuid references public.challenges(id) on delete set null;

alter table if exists public.forum_topics
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

alter table if exists public.sepbook_posts
  add column if not exists event_id uuid references public.events(id) on delete set null;

create index if not exists idx_forum_topics_campaign_id on public.forum_topics(campaign_id);
create index if not exists idx_sepbook_posts_event_id on public.sepbook_posts(event_id);

-- Create an evidence challenge for each campaign (idempotent)
create or replace function public.ensure_campaign_evidence_challenge(p_campaign_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  existing uuid;
  created uuid;
begin
  select id, title into c from public.campaigns where id = p_campaign_id;
  if c.id is null then
    return null;
  end if;

  select evidence_challenge_id into existing
  from public.campaigns
  where id = p_campaign_id;

  if existing is not null then
    -- Ensure referenced challenge still exists
    perform 1 from public.challenges where id = existing;
    if found then
      return existing;
    end if;
  end if;

  -- Best-effort reuse: if a challenge already exists for this campaign and looks like the evidence one, reuse it.
  select id into existing
  from public.challenges
  where campaign_id = p_campaign_id
    and lower(title) like 'evid%ncia%'
  order by created_at asc nulls last
  limit 1;

  if existing is null then
    insert into public.challenges (
      campaign_id,
      type,
      title,
      description,
      xp_reward,
      reward_mode,
      evidence_required,
      require_two_leader_eval
    )
    values (
      p_campaign_id,
      'inspecao',
      'Evidências — ' || c.title,
      'Envie evidências (fotos/vídeos) do andamento da campanha. Esta submissão passa por avaliação antes de gerar XP e aparecer no histórico da campanha.',
      50,
      'fixed_xp',
      true,
      true
    )
    returning id into created;
  else
    created := existing;
  end if;

  update public.campaigns
  set evidence_challenge_id = created
  where id = p_campaign_id;

  return created;
end;
$$;

-- Keep evidence_challenge_id filled automatically
create or replace function public.trg_campaign_ensure_evidence_challenge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_campaign_evidence_challenge(new.id);
  return new;
end;
$$;

drop trigger if exists trg_campaign_ensure_evidence_challenge on public.campaigns;
create trigger trg_campaign_ensure_evidence_challenge
after insert on public.campaigns
for each row execute function public.trg_campaign_ensure_evidence_challenge();

-- Backfill existing campaigns (safe)
do $$
declare
  r record;
begin
  for r in select id from public.campaigns where evidence_challenge_id is null loop
    perform public.ensure_campaign_evidence_challenge(r.id);
  end loop;
end $$;
