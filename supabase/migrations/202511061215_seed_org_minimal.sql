-- Minimal org seeds for quick online tests
insert into public.divisions (id, name) values
  ('DJT','Divisão DJT'),
  ('DJTV','Divisão DJTV'),
  ('DJTB','Divisão DJTB')
on conflict (id) do nothing;

insert into public.coordinations (id, division_id, name) values
  ('DJT-PLA','DJT','DJT PLA'),
  ('DJTV-ITP','DJTV','DJTV ITP'),
  ('DJTV-VOT','DJTV','DJTV VOT'),
  ('DJTV-PJU','DJTV','DJTV PJU'),
  ('DJTV-JUN','DJTV','DJTV JUN'),
  ('DJTB-CUB','DJTB','DJTB CUB'),
  ('DJTB-SAN','DJTB','DJTB SAN')
on conflict (id) do nothing;

insert into public.teams (id, coord_id, name) values
  ('DJT-PLA','DJT-PLA','Equipe DJT-PLA'),
  ('DJTV-ITP','DJTV-ITP','Equipe DJTV-ITP'),
  ('DJTV-VOT','DJTV-VOT','Equipe DJTV-VOT'),
  ('DJTV-PJU','DJTV-PJU','Equipe DJTV-PJU'),
  ('DJTV-JUN','DJTV-JUN','Equipe DJTV-JUN'),
  ('DJTB-CUB','DJTB-CUB','Equipe DJTB-CUB'),
  ('DJTB-SAN','DJTB-SAN','Equipe DJTB-SAN')
on conflict (id) do nothing;

