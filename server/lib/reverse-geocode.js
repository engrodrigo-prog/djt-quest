const clampLatLng = (latRaw, lngRaw) => {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9) return null;
  return { lat, lng };
};

const toCacheKey = (lat, lng) => `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;

const CACHE = new Map();
const TTL_MS = 1000 * 60 * 60 * 24 * 30;

const extractStateShort = (address) => {
  const iso = address?.['ISO3166-2-lvl4'] || address?.['ISO3166-2-lvl5'] || address?.['ISO3166-2-lvl6'] || null;
  const isoStr = typeof iso === 'string' ? iso.trim() : '';
  if (isoStr && /^BR-[A-Z]{2}$/i.test(isoStr)) return isoStr.split('-')[1].toUpperCase();
  const stateCode = typeof address?.state_code === 'string' ? address.state_code.trim() : '';
  if (stateCode && stateCode.length <= 10) return stateCode;
  return null;
};

const extractCity = (address) =>
  address?.city ||
  address?.town ||
  address?.village ||
  address?.municipality ||
  address?.borough ||
  address?.county ||
  address?.state_district ||
  address?.region ||
  address?.state ||
  null;

export async function reverseGeocodeCityLabel(latRaw, lngRaw, opts = {}) {
  const coords = clampLatLng(latRaw, lngRaw);
  if (!coords) return null;

  const key = toCacheKey(coords.lat, coords.lng);
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.value;

  const zoom = Number.isFinite(Number(opts.zoom)) ? Math.max(3, Math.min(18, Number(opts.zoom))) : 10;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
    String(coords.lat),
  )}&lon=${encodeURIComponent(String(coords.lng))}&zoom=${zoom}&addressdetails=1`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4500);
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'User-Agent': 'DJT-Quest/1.0 (reverse-geocode)',
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));

    if (!resp.ok) throw new Error(`reverse-geocode http ${resp.status}`);
    const json = await resp.json().catch(() => null);
    const address = json?.address || null;
    if (!address) throw new Error('reverse-geocode missing address');

    const city = extractCity(address);
    const stateShort = extractStateShort(address);
    const stateLong = typeof address?.state === 'string' ? address.state.trim() : null;
    const state = stateShort || stateLong;

    const cityClean = typeof city === 'string' ? city.trim() : '';
    const stateClean = typeof state === 'string' ? state.trim() : '';
    const value = [cityClean || null, stateClean && stateClean !== cityClean ? stateClean : null].filter(Boolean).join(', ') || null;

    CACHE.set(key, { ts: Date.now(), value });
    return value;
  } catch {
    CACHE.set(key, { ts: Date.now(), value: null });
    return null;
  }
}

export function normalizeLatLng(latRaw, lngRaw) {
  return clampLatLng(latRaw, lngRaw);
}

