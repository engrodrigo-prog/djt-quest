-- StudyLab hashtags + unified knowledge base (forum + StudyLab)

create table if not exists public.study_source_hashtags (
  source_id uuid references public.study_sources(id) on delete cascade not null,
  hashtag_id uuid references public.forum_hashtags(id) on delete cascade not null,
  primary key (source_id, hashtag_id)
);

create index if not exists idx_study_source_hashtags_hashtag_id
  on public.study_source_hashtags (hashtag_id);

alter table public.study_source_hashtags enable row level security;

drop policy if exists "Anyone can view study source hashtags" on public.study_source_hashtags;
create policy "Anyone can view study source hashtags"
on public.study_source_hashtags for select
to public
using (true);

drop trigger if exists after_study_source_hashtag_insert on public.study_source_hashtags;
create trigger after_study_source_hashtag_insert
after insert on public.study_source_hashtags
for each row execute function increment_hashtag_usage();

create or replace view public.knowledge_base as
select
  'forum'::text as source_type,
  ft.id as topic_id,
  fp.id as post_id,
  null::uuid as source_id,
  ft.title,
  ft.category,
  ft.created_at,
  fp.content,
  fp.content_html,
  fp.is_solution,
  fp.is_featured,
  fp.likes_count,
  p.name as author_name,
  p.tier as author_tier,
  array_agg(distinct fh.tag) filter (where fh.tag is not null) as hashtags,
  null::text as kind,
  null::text as url
from public.forum_topics ft
join public.forum_posts fp on fp.topic_id = ft.id
join public.profiles p on p.id = fp.author_id
left join public.forum_post_hashtags fph on fph.post_id = fp.id
left join public.forum_hashtags fh on fh.id = fph.hashtag_id
where ft.is_active = true
  and (fp.is_solution = true or fp.is_featured = true or fp.likes_count >= 5)
group by ft.id, ft.title, ft.category, ft.created_at,
         fp.id, fp.content, fp.content_html, fp.is_solution,
         fp.is_featured, fp.likes_count, p.name, p.tier

union all

select
  'study'::text as source_type,
  null::uuid as topic_id,
  null::uuid as post_id,
  ss.id as source_id,
  ss.title,
  ss.category,
  ss.created_at,
  coalesce(ss.summary, left(ss.full_text, 2000)) as content,
  null::text as content_html,
  false as is_solution,
  false as is_featured,
  0 as likes_count,
  null::text as author_name,
  null::text as author_tier,
  array_agg(distinct fh.tag) filter (where fh.tag is not null) as hashtags,
  ss.kind,
  ss.url
from public.study_sources ss
left join public.study_source_hashtags ssh on ssh.source_id = ss.id
left join public.forum_hashtags fh on fh.id = ssh.hashtag_id
where ss.summary is not null or ss.full_text is not null
group by ss.id, ss.title, ss.category, ss.created_at, ss.summary, ss.full_text, ss.kind, ss.url;

alter view if exists public.knowledge_base set (security_invoker = true);
