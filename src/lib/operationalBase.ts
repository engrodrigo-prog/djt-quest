export const BASE_OPTIONS_BY_SIGLA: Record<string, string[]> = {
  'DJTB-CUB': ['Cubatão'],
  'DJTB-SAN': ['Santos'],
  'DJTV-SUL': ['Votorantim'],
  'DJTB-SUDESTE': ['Salto', 'Jundiaí'],
  'DJTV-ITA': ['Itapetininga', 'Jaguariúna', 'São José do Rio Pardo', 'Mococa'],
  'DJTV-PJU': ['Avaré', 'Piraju', 'Ourinhos'],
};

// DJT PLAN pode usar qualquer base da lista conhecida
BASE_OPTIONS_BY_SIGLA['DJT-PLAN'] = Array.from(
  new Set(Object.values(BASE_OPTIONS_BY_SIGLA).flat())
);

export function getOperationalBaseOptions(siglaArea?: string | null): string[] {
  if (!siglaArea) return [];
  const key = siglaArea.trim().toUpperCase();
  return BASE_OPTIONS_BY_SIGLA[key] || [];
}

