-- Atualizar team_modifiers com valores realistas
UPDATE teams SET team_modifier = 1.20, modifier_reason = 'Equipe destaque - excelente desempenho em segurança' WHERE name = 'DJTV PJU';
UPDATE teams SET team_modifier = 1.10, modifier_reason = 'Bom desempenho geral - manutenção preventiva eficaz' WHERE name = 'DJTV ITP';
UPDATE teams SET team_modifier = 1.00, modifier_reason = 'Desempenho padrão - resultados consistentes' WHERE name = 'DJTV JUN';
UPDATE teams SET team_modifier = 0.95, modifier_reason = 'Pequenas melhorias necessárias em indicadores' WHERE name = 'DJTV VOT';
UPDATE teams SET team_modifier = 1.15, modifier_reason = 'Ótimo trabalho em equipe - baixo índice de retrabalho' WHERE name = 'DJTB CUB';
UPDATE teams SET team_modifier = 0.90, modifier_reason = 'Precisa melhorar comunicação e prazos' WHERE name = 'DJTB STO';