export const MILHAO_LEVELS = [
  { level: 1, xp: 100, faixa: 'Básico', titulo: 'Aquecimento I' },
  { level: 2, xp: 200, faixa: 'Básico', titulo: 'Aquecimento II' },
  { level: 3, xp: 300, faixa: 'Básico', titulo: 'Aquecimento III' },
  { level: 4, xp: 400, faixa: 'Intermediário', titulo: 'Desafio I' },
  { level: 5, xp: 500, faixa: 'Intermediário', titulo: 'Desafio II' },
  { level: 6, xp: 1000, faixa: 'Intermediário', titulo: 'Desafio III' },
  { level: 7, xp: 2000, faixa: 'Avançado', titulo: 'Avanço I' },
  { level: 8, xp: 3000, faixa: 'Avançado', titulo: 'Avanço II' },
  { level: 9, xp: 5000, faixa: 'Avançado', titulo: 'Avanço III' },
  { level: 10, xp: 10000, faixa: 'Sênior', titulo: 'Pergunta Máxima' },
] as const;

export type MilhaoLevel = (typeof MILHAO_LEVELS)[number];
