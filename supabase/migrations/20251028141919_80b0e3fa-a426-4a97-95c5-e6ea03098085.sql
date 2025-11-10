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
