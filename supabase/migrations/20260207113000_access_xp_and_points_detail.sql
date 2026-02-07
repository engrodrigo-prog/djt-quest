-- Access XP (0.5 per tracked access) + detailed points ledger for Rankings.

create unique index if not exists ux_xp_awards_access_daily
  on public.xp_awards (user_id, kind, (coalesce(metadata ->> 'access_key', '')))
  where kind in ('access_login', 'access_session', 'access_pageview');

-- Extend points breakdown with access sessions/XP.
drop function if exists public.user_points_breakdown(uuid[]);
create or replace function public.user_points_breakdown(_user_ids uuid[])
returns table(
  user_id uuid,
  quiz_xp integer,
  forum_posts integer,
  sepbook_photo_count integer,
  sepbook_comments integer,
  sepbook_likes integer,
  initiatives_xp integer,
  evaluations_completed integer,
  quiz_publish_xp integer,
  access_sessions integer,
  access_xp numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select unnest(coalesce(_user_ids, array[]::uuid[])) as user_id
  ),
  quiz as (
    select user_id, coalesce(sum(coalesce(xp_earned,0)),0)::int as quiz_xp
    from public.user_quiz_answers
    where user_id = any(_user_ids)
    group by user_id
  ),
  forum as (
    select coalesce(author_id, user_id) as user_id, count(*)::int as forum_posts
    from public.forum_posts
    where coalesce(author_id, user_id) = any(_user_ids)
    group by 1
  ),
  sep_photos as (
    select user_id, coalesce(sum(public.count_image_attachments(attachments)),0)::int as sepbook_photo_count
    from public.sepbook_posts
    where user_id = any(_user_ids)
    group by user_id
  ),
  sep_comments as (
    select user_id, count(*)::int as sepbook_comments
    from public.sepbook_comments
    where user_id = any(_user_ids)
    group by user_id
  ),
  sep_likes as (
    select user_id, count(*)::int as likes
    from public.sepbook_likes
    where user_id = any(_user_ids)
    group by user_id
  ),
  sep_comment_likes as (
    select user_id, count(*)::int as likes
    from public.sepbook_comment_likes
    where user_id = any(_user_ids)
    group by user_id
  ),
  ev as (
    select user_id, coalesce(sum(coalesce(final_points,0)),0)::int as initiatives_xp
    from public.events
    where user_id = any(_user_ids)
    group by user_id
  ),
  evals as (
    select assigned_to as user_id,
           count(*) filter (where completed_at is not null)::int as evaluations_completed
    from public.evaluation_queue
    where assigned_to = any(_user_ids)
    group by assigned_to
  ),
  qp as (
    select user_id, coalesce(sum(amount),0)::int as quiz_publish_xp
    from public.xp_awards
    where user_id = any(_user_ids)
      and kind = 'quiz_publish'
    group by user_id
  ),
  acc as (
    select user_id, coalesce(sum(amount),0)::int as access_sessions
    from public.xp_awards
    where user_id = any(_user_ids)
      and kind like 'access_%'
    group by user_id
  )
  select u.user_id,
         coalesce(quiz.quiz_xp,0) as quiz_xp,
         coalesce(forum.forum_posts,0) as forum_posts,
         coalesce(sep_photos.sepbook_photo_count,0) as sepbook_photo_count,
         coalesce(sep_comments.sepbook_comments,0) as sepbook_comments,
         (coalesce(sep_likes.likes,0) + coalesce(sep_comment_likes.likes,0))::int as sepbook_likes,
         coalesce(ev.initiatives_xp,0) as initiatives_xp,
         coalesce(evals.evaluations_completed,0) as evaluations_completed,
         coalesce(qp.quiz_publish_xp,0) as quiz_publish_xp,
         coalesce(acc.access_sessions,0) as access_sessions,
         round(coalesce(acc.access_sessions,0)::numeric * 0.5, 1) as access_xp
  from u
  left join quiz on quiz.user_id = u.user_id
  left join forum on forum.user_id = u.user_id
  left join sep_photos on sep_photos.user_id = u.user_id
  left join sep_comments on sep_comments.user_id = u.user_id
  left join sep_likes on sep_likes.user_id = u.user_id
  left join sep_comment_likes on sep_comment_likes.user_id = u.user_id
  left join ev on ev.user_id = u.user_id
  left join evals on evals.user_id = u.user_id
  left join qp on qp.user_id = u.user_id
  left join acc on acc.user_id = u.user_id;
$$;

-- Detailed ledger used by Ranking -> User drilldown.
create or replace function public.user_points_detail(_user_id uuid)
returns table(
  source_key text,
  category text,
  source_type text,
  source_id uuid,
  created_at timestamptz,
  points numeric,
  title text,
  subtitle text,
  campaign_id uuid,
  campaign_title text,
  challenge_id uuid,
  challenge_title text,
  details jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with quiz_rows as (
    select
      'quiz_answer:' || qa.id::text as source_key,
      'quiz'::text as category,
      'quiz_answer'::text as source_type,
      qa.id as source_id,
      coalesce(qa.answered_at, ch.published_at, ch.created_at, now()) as created_at,
      coalesce(qa.xp_earned, 0)::numeric as points,
      coalesce(ch.title, 'Quiz') as title,
      coalesce(case when cp.title is not null then 'Campanha: ' || cp.title end, 'Resposta de quiz') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      jsonb_build_object('question_id', qa.question_id, 'is_correct', qa.is_correct) as details
    from public.user_quiz_answers qa
    left join public.challenges ch on ch.id = qa.challenge_id
    left join public.campaigns cp on cp.id = ch.campaign_id
    where qa.user_id = _user_id
      and coalesce(qa.xp_earned, 0) <> 0
  ),
  event_rows as (
    select
      'event:' || e.id::text as source_key,
      'campanha'::text as category,
      'challenge_event'::text as source_type,
      e.id as source_id,
      e.created_at,
      coalesce(e.final_points, 0)::numeric as points,
      coalesce(ch.title, 'Ação avaliada') as title,
      coalesce(case when cp.title is not null then 'Campanha: ' || cp.title end, 'Evento validado') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      jsonb_build_object('status', e.status, 'assignment_type', e.assignment_type) as details
    from public.events e
    left join public.challenges ch on ch.id = e.challenge_id
    left join public.campaigns cp on cp.id = ch.campaign_id
    where e.user_id = _user_id
      and coalesce(e.final_points, 0) <> 0
  ),
  forum_rows as (
    select
      'forum_post:' || fp.id::text as source_key,
      'forum'::text as category,
      'forum_post'::text as source_type,
      fp.id as source_id,
      fp.created_at,
      10::numeric as points,
      coalesce(nullif(left(trim(regexp_replace(coalesce(fp.content, ''), '\s+', ' ', 'g')), 100), ''), 'Post no fórum') as title,
      coalesce(ft.title, 'Discussão no fórum') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      jsonb_build_object('topic_id', ft.id) as details
    from public.forum_posts fp
    left join public.forum_topics ft on ft.id = fp.topic_id
    left join public.challenges ch on ch.id = ft.challenge_id
    left join public.campaigns cp on cp.id = coalesce(ft.campaign_id, ch.campaign_id)
    where coalesce(fp.author_id, fp.user_id) = _user_id
  ),
  sep_post_rows as (
    select
      'sepbook_post:' || sp.id::text as source_key,
      'sepbook'::text as category,
      'sepbook_post_photo'::text as source_type,
      sp.id as source_id,
      sp.created_at,
      (public.count_image_attachments(sp.attachments) * 5)::numeric as points,
      coalesce(nullif(left(trim(regexp_replace(coalesce(sp.content_md, ''), '\s+', ' ', 'g')), 100), ''), 'Publicação no SEPBook') as title,
      coalesce(case when cp.title is not null then 'Campanha: ' || cp.title end, 'Mídia publicada no SEPBook') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      jsonb_build_object(
        'post_kind', sp.post_kind,
        'photo_count', public.count_image_attachments(sp.attachments),
        'event_id', sp.event_id
      ) as details
    from public.sepbook_posts sp
    left join public.challenges ch on ch.id = sp.challenge_id
    left join public.campaigns cp on cp.id = coalesce(sp.campaign_id, ch.campaign_id)
    where sp.user_id = _user_id
      and public.count_image_attachments(sp.attachments) > 0
  ),
  sep_comment_rows as (
    select
      'sepbook_comment:' || sc.id::text as source_key,
      'sepbook'::text as category,
      'sepbook_comment'::text as source_type,
      sc.id as source_id,
      sc.created_at,
      2::numeric as points,
      coalesce(nullif(left(trim(regexp_replace(coalesce(sc.content_md, ''), '\s+', ' ', 'g')), 100), ''), 'Comentário no SEPBook') as title,
      coalesce(case when cp.title is not null then 'Campanha: ' || cp.title end, 'Comentário em publicação') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      jsonb_build_object('post_id', sp.id) as details
    from public.sepbook_comments sc
    left join public.sepbook_posts sp on sp.id = sc.post_id
    left join public.challenges ch on ch.id = sp.challenge_id
    left join public.campaigns cp on cp.id = coalesce(sp.campaign_id, ch.campaign_id)
    where sc.user_id = _user_id
  ),
  sep_like_rows as (
    select
      'sepbook_like:' || sl.post_id::text || ':' || sl.user_id::text as source_key,
      'sepbook'::text as category,
      'sepbook_like'::text as source_type,
      sl.post_id as source_id,
      sl.created_at,
      1::numeric as points,
      coalesce(nullif(left(trim(regexp_replace(coalesce(sp.content_md, ''), '\s+', ' ', 'g')), 100), ''), 'Curtida no SEPBook') as title,
      coalesce(case when cp.title is not null then 'Campanha: ' || cp.title end, 'Curtida recebida') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      jsonb_build_object('post_id', sp.id) as details
    from public.sepbook_likes sl
    left join public.sepbook_posts sp on sp.id = sl.post_id
    left join public.challenges ch on ch.id = sp.challenge_id
    left join public.campaigns cp on cp.id = coalesce(sp.campaign_id, ch.campaign_id)
    where sl.user_id = _user_id
  ),
  sep_comment_like_rows as (
    select
      'sepbook_comment_like:' || scl.comment_id::text || ':' || scl.user_id::text as source_key,
      'sepbook'::text as category,
      'sepbook_comment_like'::text as source_type,
      scl.comment_id as source_id,
      scl.created_at,
      1::numeric as points,
      coalesce(nullif(left(trim(regexp_replace(coalesce(sc.content_md, ''), '\s+', ' ', 'g')), 100), ''), 'Curtida em comentário do SEPBook') as title,
      coalesce(case when cp.title is not null then 'Campanha: ' || cp.title end, 'Curtida recebida em comentário') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      jsonb_build_object('post_id', sp.id, 'comment_id', sc.id) as details
    from public.sepbook_comment_likes scl
    left join public.sepbook_comments sc on sc.id = scl.comment_id
    left join public.sepbook_posts sp on sp.id = sc.post_id
    left join public.challenges ch on ch.id = sp.challenge_id
    left join public.campaigns cp on cp.id = coalesce(sp.campaign_id, ch.campaign_id)
    where scl.user_id = _user_id
  ),
  evaluation_rows as (
    select
      'evaluation:' || eq.id::text as source_key,
      'avaliacoes'::text as category,
      'evaluation_completed'::text as source_type,
      eq.id as source_id,
      coalesce(eq.completed_at, eq.created_at) as created_at,
      5::numeric as points,
      coalesce(ch.title, 'Avaliação concluída') as title,
      coalesce(case when cp.title is not null then 'Campanha: ' || cp.title end, 'Revisão concluída') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      jsonb_build_object('event_id', eq.event_id) as details
    from public.evaluation_queue eq
    left join public.events e on e.id = eq.event_id
    left join public.challenges ch on ch.id = e.challenge_id
    left join public.campaigns cp on cp.id = ch.campaign_id
    where eq.assigned_to = _user_id
      and eq.completed_at is not null
  ),
  quiz_publish_rows as (
    select
      'xp_award:' || xa.id::text as source_key,
      'quiz'::text as category,
      'quiz_publish'::text as source_type,
      xa.id as source_id,
      xa.created_at,
      coalesce(xa.amount, 0)::numeric as points,
      coalesce(ch.title, 'Publicação de quiz') as title,
      coalesce(case when cp.title is not null then 'Campanha: ' || cp.title end, 'Bônus de publicação') as subtitle,
      cp.id as campaign_id,
      cp.title as campaign_title,
      ch.id as challenge_id,
      ch.title as challenge_title,
      coalesce(xa.metadata, '{}'::jsonb) as details
    from public.xp_awards xa
    left join public.challenges ch on ch.id = xa.quiz_id
    left join public.campaigns cp on cp.id = ch.campaign_id
    where xa.user_id = _user_id
      and xa.kind = 'quiz_publish'
      and coalesce(xa.amount, 0) <> 0
  ),
  access_rows as (
    select
      'xp_award:' || xa.id::text as source_key,
      'acesso'::text as category,
      'access_session'::text as source_type,
      xa.id as source_id,
      xa.created_at,
      round(coalesce(xa.amount, 0)::numeric * 0.5, 1) as points,
      case xa.kind
        when 'access_login' then 'Acesso na plataforma (login)'
        when 'access_pageview' then 'Acesso na plataforma (página)'
        else 'Acesso na plataforma'
      end as title,
      coalesce(nullif(xa.metadata ->> 'path', ''), 'Rastreamento de acesso diário') as subtitle,
      null::uuid as campaign_id,
      null::text as campaign_title,
      null::uuid as challenge_id,
      null::text as challenge_title,
      coalesce(xa.metadata, '{}'::jsonb) as details
    from public.xp_awards xa
    where xa.user_id = _user_id
      and xa.kind like 'access_%'
      and coalesce(xa.amount, 0) <> 0
  )
  select *
  from (
    select * from quiz_rows
    union all
    select * from event_rows
    union all
    select * from forum_rows
    union all
    select * from sep_post_rows
    union all
    select * from sep_comment_rows
    union all
    select * from sep_like_rows
    union all
    select * from sep_comment_like_rows
    union all
    select * from evaluation_rows
    union all
    select * from quiz_publish_rows
    union all
    select * from access_rows
  ) rows
  where coalesce(points, 0) <> 0
  order by created_at desc nulls last, source_key desc;
$$;
