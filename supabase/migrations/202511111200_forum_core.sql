-- Forum core schema: topics, posts, reactions, watchers, compendia, monthly scores

create table if not exists public.forum_topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_by uuid not null references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open','curated','closed')),
  chas_dimension char(1) not null default 'C' check (chas_dimension in ('C','H','A','S')),
  quiz_specialties text[],
  tags text[],
  related_challenge_id uuid references public.challenges(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_forum_topics_status on public.forum_topics(status);
alter table public.forum_topics enable row level security;

-- RLS: view for all; create/update for leaders; creator can edit own
do $$ begin
  if not exists (select 1 from pg_policies where policyname='ForumTopics: select all' and tablename='forum_topics') then
    create policy "ForumTopics: select all" on public.forum_topics for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumTopics: leaders insert' and tablename='forum_topics') then
    create policy "ForumTopics: leaders insert" on public.forum_topics for insert with check (
      public.has_role((select auth.uid()), 'coordenador_djtx') or
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') or
      public.has_role((select auth.uid()), 'gerente_djt') or
      public.has_role((select auth.uid()), 'admin')
    );
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumTopics: edit by creator or leaders' and tablename='forum_topics') then
    create policy "ForumTopics: edit by creator or leaders" on public.forum_topics for update using (
      created_by = (select auth.uid()) or
      public.has_role((select auth.uid()), 'coordenador_djtx') or
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') or
      public.has_role((select auth.uid()), 'gerente_djt') or
      public.has_role((select auth.uid()), 'admin')
    );
  end if;
end $$;

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.forum_topics(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete set null,
  content_md text not null,
  payload jsonb not null default '{}'::jsonb, -- {images:[], files:[], audio_url, transcript}
  parent_post_id uuid references public.forum_posts(id) on delete cascade,
  ai_assessment jsonb default null, -- {helpfulness, clarity, novelty, toxicity, flags, tags:[], chas?:'C|H|A|S'}
  tags text[],
  created_at timestamptz not null default now()
);

create index if not exists idx_forum_posts_topic on public.forum_posts(topic_id);
alter table public.forum_posts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='ForumPosts: select' and tablename='forum_posts') then
    create policy "ForumPosts: select" on public.forum_posts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumPosts: insert own' and tablename='forum_posts') then
    create policy "ForumPosts: insert own" on public.forum_posts for insert with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumPosts: update own' and tablename='forum_posts') then
    create policy "ForumPosts: update own" on public.forum_posts for update using ((select auth.uid()) = user_id);
  end if;
end $$;

create table if not exists public.forum_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('like','helpful','agree','insight')),
  created_at timestamptz not null default now(),
  unique(post_id, user_id, type)
);
alter table public.forum_reactions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='ForumReactions: select' and tablename='forum_reactions') then
    create policy "ForumReactions: select" on public.forum_reactions for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumReactions: insert own' and tablename='forum_reactions') then
    create policy "ForumReactions: insert own" on public.forum_reactions for insert with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumReactions: delete own' and tablename='forum_reactions') then
    create policy "ForumReactions: delete own" on public.forum_reactions for delete using ((select auth.uid()) = user_id);
  end if;
end $$;

create table if not exists public.forum_topic_watchers (
  topic_id uuid not null references public.forum_topics(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key(topic_id, user_id)
);
alter table public.forum_topic_watchers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='ForumTopicWatchers: own' and tablename='forum_topic_watchers') then
    create policy "ForumTopicWatchers: own" on public.forum_topic_watchers for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;

create table if not exists public.forum_compendia (
  topic_id uuid primary key references public.forum_topics(id) on delete cascade,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  summary_md text,
  key_learnings jsonb,
  suggested_quizzes jsonb,
  suggested_challenges jsonb,
  attachments jsonb
);
alter table public.forum_compendia enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='ForumCompendia: select' and tablename='forum_compendia') then
    create policy "ForumCompendia: select" on public.forum_compendia for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='ForumCompendia: leaders upsert' and tablename='forum_compendia') then
    create policy "ForumCompendia: leaders upsert" on public.forum_compendia for all using (
      public.has_role((select auth.uid()), 'coordenador_djtx') or
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') or
      public.has_role((select auth.uid()), 'gerente_djt') or
      public.has_role((select auth.uid()), 'admin')
    ) with check (
      public.has_role((select auth.uid()), 'coordenador_djtx') or
      public.has_role((select auth.uid()), 'gerente_divisao_djtx') or
      public.has_role((select auth.uid()), 'gerente_djt') or
      public.has_role((select auth.uid()), 'admin')
    );
  end if;
end $$;

create table if not exists public.forum_monthly_scores (
  month text not null, -- YYYY-MM
  user_id uuid not null references public.profiles(id) on delete cascade,
  qty_points int not null default 0,
  qual_points int not null default 0,
  final_points int not null default 0,
  breakdown jsonb,
  primary key(month, user_id)
);
alter table public.forum_monthly_scores enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='ForumMonthlyScores: select' and tablename='forum_monthly_scores') then
    create policy "ForumMonthlyScores: select" on public.forum_monthly_scores for select using (true);
  end if;
end $$;

