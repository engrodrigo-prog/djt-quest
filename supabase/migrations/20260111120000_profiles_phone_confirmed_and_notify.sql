-- Require users to confirm WhatsApp phone and notify everyone to update it.

alter table public.profiles
  add column if not exists phone_confirmed_at timestamptz;

create index if not exists idx_profiles_phone_confirmed_at on public.profiles(phone_confirmed_at);

-- One-time notification for all current users (they will also be gated on next login).
insert into public.notifications (user_id, type, title, message, metadata)
select
  p.id as user_id,
  'system' as type,
  'Atualize seu WhatsApp' as title,
  'No próximo login, confirme ou atualize seu número de WhatsApp para facilitar o contato.' as message,
  jsonb_build_object('kind', 'phone_update_required') as metadata
from public.profiles p;

