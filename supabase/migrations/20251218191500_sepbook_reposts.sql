-- SEPBook: reposts (share inside the app, similar to Instagram repost)
alter table if exists public.sepbook_posts
  add column if not exists repost_of uuid references public.sepbook_posts(id) on delete set null;

create index if not exists idx_sepbook_posts_repost_of on public.sepbook_posts(repost_of);

