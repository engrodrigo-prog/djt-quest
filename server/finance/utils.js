export const parseBrlToCents = (raw) => {
  const s0 = String(raw ?? '').trim();
  if (!s0) return null;

  // Keep only digits and separators ("," "."); reject negatives.
  const s = s0.replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;
  if (s.includes('-')) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const hasComma = lastComma >= 0;
  const hasDot = lastDot >= 0;

  // Decide decimal separator:
  // - If both are present: last one is decimal.
  // - If only one is present: it's decimal only if it has 1-2 digits after it.
  let decimalSep = null;
  if (hasComma && hasDot) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (hasComma) {
    const digitsAfter = s.length - lastComma - 1;
    if (digitsAfter === 1 || digitsAfter === 2) decimalSep = ',';
  } else if (hasDot) {
    const digitsAfter = s.length - lastDot - 1;
    if (digitsAfter === 1 || digitsAfter === 2) decimalSep = '.';
  }

  let integerPart = s;
  let fracPart = '';
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    integerPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
  }

  const integerDigits = integerPart.replace(/\D/g, '');
  const fracDigits = fracPart.replace(/\D/g, '');
  if (fracDigits.length > 2) return null;

  const whole = Number(integerDigits || '0');
  if (!Number.isFinite(whole)) return null;
  const frac = Number((fracDigits || '').padEnd(2, '0') || '0');
  if (!Number.isFinite(frac)) return null;

  const cents = whole * 100 + frac;
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
