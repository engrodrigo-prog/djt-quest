export function getQuizScoreTone(pct: number | null | undefined) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 'neutral';
  if (pct >= 100) return 'green';
  if (pct > 81) return 'blue';
  return 'orange';
}

export function getQuizScoreBadgeClassName(pct: number | null | undefined) {
  const tone = getQuizScoreTone(pct);
  if (tone === 'green') {
    return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300';
  }
  if (tone === 'blue') {
    return 'border-blue-500/40 bg-blue-500/15 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300';
  }
  if (tone === 'orange') {
    return 'border-orange-500/40 bg-orange-500/15 text-orange-700 hover:bg-orange-500/20 dark:text-orange-300';
  }
  return '';
}
