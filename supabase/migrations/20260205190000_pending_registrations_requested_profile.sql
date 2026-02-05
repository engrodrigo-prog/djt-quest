-- Registration: allow invite links to predefine requested profile type

alter table public.pending_registrations
  add column if not exists requested_profile text;

comment on column public.pending_registrations.requested_profile is
  'Requested profile type at signup (collaborator/leader/guest), usually set via invite link.';

