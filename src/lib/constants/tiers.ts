export const TIER_CONFIG = {
  tiers: [
    {
      slug: "executor",
      displayName: "Executor",
      prefix: "EX",
      color: "blue",
      icon: "Star",
      levels: [
        { code: "EX-1", name: "Executor Base", xpMin: 0, xpMax: 299 },
        { code: "EX-2", name: "Executor Seguro", xpMin: 300, xpMax: 699 },
        { code: "EX-3", name: "Executor Ágil", xpMin: 700, xpMax: 1199 },
        { code: "EX-4", name: "Executor Preciso", xpMin: 1200, xpMax: 1799 },
        { code: "EX-5", name: "Executor de Excelência", xpMin: 1800, xpMax: Infinity }
      ]
    },
    {
      slug: "formador",
      displayName: "Formador",
      prefix: "FO",
      color: "green",
      icon: "Award",
      levels: [
        { code: "FO-1", name: "Formador Base", xpMin: 0, xpMax: 399 },
        { code: "FO-2", name: "Formador Seguro", xpMin: 400, xpMax: 899 },
        { code: "FO-3", name: "Formador Facilitador", xpMin: 900, xpMax: 1499 },
        { code: "FO-4", name: "Formador Mentor", xpMin: 1500, xpMax: 2199 },
        { code: "FO-5", name: "Formador Multiplicador", xpMin: 2200, xpMax: Infinity }
      ]
    },
    {
      slug: "guardiao",
      displayName: "Guardião",
      prefix: "GU",
      color: "purple",
      icon: "Shield",
      levels: [
        { code: "GU-1", name: "Guardião Base", xpMin: 0, xpMax: 499 },
        { code: "GU-2", name: "Guardião Vigilante", xpMin: 500, xpMax: 1099 },
        { code: "GU-3", name: "Guardião Integrador", xpMin: 1100, xpMax: 1799 },
        { code: "GU-4", name: "Guardião Interdependente", xpMin: 1800, xpMax: 2599 },
        { code: "GU-5", name: "Guardião Embaixador", xpMin: 2600, xpMax: Infinity }
      ]
    }
  ]
};

export function getTierInfo(tierCode: string) {
  for (const tier of TIER_CONFIG.tiers) {
    const level = tier.levels.find(l => l.code === tierCode);
    if (level) {
      return {
        tier: tier.displayName,
        prefix: tier.prefix,
        color: tier.color,
        icon: tier.icon,
        ...level
      };
    }
  }
  return null;
}

export function getTierColor(tierCode: string) {
  const info = getTierInfo(tierCode);
  if (!info) return 'text-muted-foreground bg-muted border-border';
  
  switch (info.color) {
    case 'blue': return 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800';
    case 'green': return 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800';
    case 'purple': return 'text-purple-600 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950 dark:border-purple-800';
    default: return 'text-muted-foreground bg-muted border-border';
  }
}

export function getNextTierLevel(tierCode: string, xp: number) {
  const info = getTierInfo(tierCode);
  if (!info) return null;
  
  const tier = TIER_CONFIG.tiers.find(t => t.prefix === info.prefix);
  if (!tier) return null;
  
  const currentIndex = tier.levels.findIndex(l => l.code === tierCode);
  if (currentIndex === -1 || currentIndex === tier.levels.length - 1) return null;
  
  const nextLevel = tier.levels[currentIndex + 1];
  return {
    ...nextLevel,
    xpNeeded: nextLevel.xpMin - xp
  };
}

export function canRequestTierProgression(tierCode: string): boolean {
  const levelNum = parseInt(tierCode.split('-')[1]);
  return levelNum === 5;
}

export function getNextTierPrefix(currentPrefix: string): string | null {
  if (currentPrefix === 'EX') return 'FO';
  if (currentPrefix === 'FO') return 'GU';
  return null;
}
