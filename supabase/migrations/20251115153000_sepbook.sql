-- SEPBook: social feed for DJT Quest
create table if not exists public.sepbook_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_md text not null,
  attachments jsonb,
  has_media boolean not null default false,
  visibility text not null default 'internal',
  is_story boolean not null default false,
  story_expires_at timestamptz,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  location_label text,
  location_lat double precision,
  location_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sepbook_posts_created_at on public.sepbook_posts(created_at desc);
create index if not exists idx_sepbook_posts_user_id on public.sepbook_posts(user_id);

create table if not exists public.sepbook_likes (
  post_id uuid not null references public.sepbook_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.sepbook_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.sepbook_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_md text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sepbook_comments_post_id_created_at on public.sepbook_comments(post_id, created_at);

