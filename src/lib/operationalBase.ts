export const BASE_OPTIONS_BY_SIGLA: Record<string, string[]> = {
  'DJTB-CUB': ['Cubatão'],
  'DJTB-STO': ['Santos'],
  // legados/aliases (mantidos para compatibilidade)
  'DJTB-SAN': ['Santos'],
  'DJTB-SUDESTE': ['Salto', 'Jundiaí'],
  'DJTV-VOR': ['Votorantim'],
  'DJTV-SUL': ['Votorantim'],
  'DJTV-JUN': ['Jundiaí'],
  'DJTV-ITA': ['Itapetininga', 'Jaguariúna', 'São José do Rio Pardo', 'Mococa'],
  'DJTV-PJU': ['Avaré', 'Piraju', 'Ourinhos'],
};

const uniq = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

export function getOperationalBaseOptions(siglaArea?: string | null): string[] {
  if (!siglaArea) return [];
  const key = siglaArea.trim().toUpperCase();
  const direct = BASE_OPTIONS_BY_SIGLA[key];
  if (direct?.length) return direct;

  // Agregados (ex.: DJTB, DJTV, DJT-PLAN)
  if (key === 'DJTB') return uniq(Object.entries(BASE_OPTIONS_BY_SIGLA).filter(([k]) => k.startsWith('DJTB-')).flatMap(([, v]) => v));
  if (key === 'DJTV') return uniq(Object.entries(BASE_OPTIONS_BY_SIGLA).filter(([k]) => k.startsWith('DJTV-')).flatMap(([, v]) => v));
  if (key === 'DJT' || key === 'DJT-PLAN') return uniq(Object.values(BASE_OPTIONS_BY_SIGLA).flat());

  return [];
}
