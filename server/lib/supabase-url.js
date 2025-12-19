export function normalizeSupabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const s = rawUrl.trim();
  if (!s) return null;

  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    try {
      parsed = new URL(`https://${s}`);
    } catch {
      return null;
    }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  // Normalize to origin (no trailing slash/path), which is what supabase-js expects.
  return parsed.origin;
}

const isLocalHostname = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1';

export function getSupabaseUrlFromEnv(env = process.env, opts = {}) {
  const { expectedHostname, allowLocal = true } = opts;
  const candidates = [env.SUPABASE_URL, env.VITE_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL];
  for (const raw of candidates) {
    const normalized = normalizeSupabaseUrl(raw);
    if (!normalized) continue;
    if (expectedHostname) {
      try {
        const hostname = new URL(normalized).hostname;
        if (allowLocal && isLocalHostname(hostname)) return normalized;
        if (hostname !== expectedHostname) continue;
      } catch {
        continue;
      }
    }
    return normalized;
  }
  return '';
}
