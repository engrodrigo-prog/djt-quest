-- Multilingual support for forum topics, posts and compendia

alter table if exists public.forum_topics
  add column if not exists title_translations jsonb default '{}'::jsonb,
  add column if not exists description_translations jsonb default '{}'::jsonb;

alter table if exists public.forum_posts
  add column if not exists translations jsonb default '{}'::jsonb;

alter table if exists public.forum_compendia
  add column if not exists summary_translations jsonb default '{}'::jsonb;

-- Seed base locale for existing content (best-effort)
update public.forum_topics
  set title_translations = jsonb_set(coalesce(title_translations, '{}'::jsonb), '{pt-BR}', to_jsonb(title), true)
where title is not null;

update public.forum_topics
  set description_translations = jsonb_set(coalesce(description_translations, '{}'::jsonb), '{pt-BR}', to_jsonb(coalesce(description, '')), true)
where description is not null;

update public.forum_posts
  set translations = jsonb_set(coalesce(translations, '{}'::jsonb), '{pt-BR}', to_jsonb(content_md), true)
where content_md is not null;

update public.forum_compendia
  set summary_translations = jsonb_set(coalesce(summary_translations, '{}'::jsonb), '{pt-BR}', to_jsonb(coalesce(summary_md, '')), true)
where summary_md is not null;
