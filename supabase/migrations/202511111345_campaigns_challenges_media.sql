-- Add cover image fields to campaigns and challenges
alter table if exists public.campaigns
  add column if not exists cover_image_url text,
  add column if not exists media_urls text[];

alter table if exists public.challenges
  add column if not exists cover_image_url text,
  add column if not exists media_urls text[];

