export const parseBrlToCents = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (!Number.isFinite(cents)) return null;
  return cents;
};

export const pickQueryParam = (q, key) => {
  const raw = q?.[key];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0];
  return '';
};

export const clampLimit = (v, def = 50, max = 200) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
};

export const safeText = (v, max = 2000) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
};

export const tryParseStorageFromPublicUrl = (params) => {
  const base = String(params?.supabaseUrl || '').replace(/\/+$/, '');
  const url = String(params?.url || '').trim();
  if (!base || !url) return { bucket: null, path: null };

  const prefix = `${base}/storage/v1/object/public/`;
  if (!url.startsWith(prefix)) return { bucket: null, path: null };

  const rest = url.slice(prefix.length);
  const idx = rest.indexOf('/');
  if (idx <= 0) return { bucket: null, path: null };
  const bucket = rest.slice(0, idx);
  const path = rest.slice(idx + 1);
  return { bucket: bucket || null, path: path || null };
};

