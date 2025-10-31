export interface TierRange {
  min: number;
  max: number;
  code: string;
  name: string;
}

export interface TierRanges {
  EX: TierRange[];
  FO: TierRange[];
  GU: TierRange[];
}

export const TIER_RANGES: TierRanges = {
  EX: [
    { min: 0, max: 299, code: 'EX-1', name: 'Explorador 1' },
    { min: 300, max: 699, code: 'EX-2', name: 'Explorador 2' },
    { min: 700, max: 1199, code: 'EX-3', name: 'Explorador 3' },
    { min: 1200, max: 1799, code: 'EX-4', name: 'Explorador 4' },
    { min: 1800, max: 999999, code: 'EX-5', name: 'Explorador 5' }
  ],
  FO: [
    { min: 0, max: 399, code: 'FO-1', name: 'Forjador 1' },
    { min: 400, max: 899, code: 'FO-2', name: 'Forjador 2' },
    { min: 900, max: 1499, code: 'FO-3', name: 'Forjador 3' },
    { min: 1500, max: 2199, code: 'FO-4', name: 'Forjador 4' },
    { min: 2200, max: 999999, code: 'FO-5', name: 'Forjador 5' }
  ],
  GU: [
    { min: 0, max: 499, code: 'GU-1', name: 'Guardião 1' },
    { min: 500, max: 1099, code: 'GU-2', name: 'Guardião 2' },
    { min: 1100, max: 1799, code: 'GU-3', name: 'Guardião 3' },
    { min: 1800, max: 2599, code: 'GU-4', name: 'Guardião 4' },
    { min: 2600, max: 999999, code: 'GU-5', name: 'Guardião 5' }
  ]
};

export function calculateTierFromXp(xp: number, currentTierPrefix: string = 'EX'): string {
  const tierRanges = TIER_RANGES[currentTierPrefix as keyof typeof TIER_RANGES] || TIER_RANGES.EX;
  
  for (const range of tierRanges) {
    if (xp >= range.min && xp <= range.max) {
      return range.code;
    }
  }
  
  return tierRanges[0].code;
}

export function getNextTierInfo(xp: number, currentTierCode: string) {
  const prefix = currentTierCode.split('-')[0] as keyof typeof TIER_RANGES;
  const tierRanges = TIER_RANGES[prefix] || TIER_RANGES.EX;
  
  for (let i = 0; i < tierRanges.length; i++) {
    const range = tierRanges[i];
    if (xp >= range.min && xp <= range.max) {
      // Se for o último tier, não há próximo
      if (i === tierRanges.length - 1) {
        return {
          nextTier: null,
          xpNeeded: 0,
          currentMax: range.max,
          progress: 100
        };
      }
      
      const nextRange = tierRanges[i + 1];
      const xpNeeded = nextRange.min - xp;
      const currentRangeSize = range.max - range.min + 1;
      const xpInCurrentRange = xp - range.min;
      const progress = (xpInCurrentRange / currentRangeSize) * 100;
      
      return {
        nextTier: nextRange.code,
        nextTierName: nextRange.name,
        xpNeeded,
        currentMax: range.max,
        progress: Math.min(progress, 100)
      };
    }
  }
  
  return {
    nextTier: null,
    xpNeeded: 0,
    currentMax: 0,
    progress: 0
  };
}

export function getTierInfo(tierCode: string) {
  const prefix = tierCode.split('-')[0] as keyof typeof TIER_RANGES;
  const tierRanges = TIER_RANGES[prefix];
  
  if (!tierRanges) return null;
  
  return tierRanges.find(range => range.code === tierCode) || null;
}
