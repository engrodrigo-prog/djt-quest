-- Garantir hierarquia mínima antes de criar o time
INSERT INTO public.departments (id, name)
VALUES ('d1111111-1111-1111-1111-111111111111'::uuid, 'DJT - Subtransmissão CPFL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.divisions (id, name, department_id)
VALUES ('00000003-0000-0000-0000-000000000003'::uuid, 'DJTX', 'd1111111-1111-1111-1111-111111111111'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.coordinations (id, name, division_id)
VALUES ('00000031-0000-0000-0000-000000000001'::uuid, 'DJTX-ABC', '00000003-0000-0000-0000-000000000003'::uuid)
ON CONFLICT (id) DO NOTHING;

-- Criar novo time DJTX-ABC
INSERT INTO teams (id, name, coordination_id, team_modifier, modifier_reason)
VALUES (
  '00000131-0000-0000-0000-000000000001',
  'DJTX ABC',
  '00000031-0000-0000-0000-000000000001',
  0.85,
  'Time novo em formação - precisa desenvolvimento'
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  coordination_id = EXCLUDED.coordination_id,
  team_modifier = EXCLUDED.team_modifier,
  modifier_reason = EXCLUDED.modifier_reason;
