-- Add updated_at columns expected by triggers
alter table if exists public.profiles add column if not exists updated_at timestamptz not null default now();
alter table if exists public.campaigns add column if not exists updated_at timestamptz not null default now();
alter table if exists public.challenges add column if not exists updated_at timestamptz not null default now();
alter table if exists public.events add column if not exists updated_at timestamptz not null default now();

