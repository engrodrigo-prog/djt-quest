-- SEPBook comments: store GPS/location so comment photos can appear on the map/list.

alter table if exists public.sepbook_comments
  add column if not exists location_label text,
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision;

create index if not exists idx_sepbook_comments_location
  on public.sepbook_comments (location_lat, location_lng)
  where location_lat is not null and location_lng is not null;

