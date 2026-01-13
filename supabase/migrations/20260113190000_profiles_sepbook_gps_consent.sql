-- Persist SEPBook GPS consent per user (no repeated prompts).

alter table if exists public.profiles
  add column if not exists sepbook_gps_consent boolean;

