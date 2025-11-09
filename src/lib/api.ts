const rawBase = import.meta.env.VITE_API_BASE_URL?.trim();
const sanitizedBase =
  rawBase && rawBase.length > 1
    ? rawBase.replace(/\/+$/, '')
    : '';

export const apiBaseUrl = sanitizedBase;

export const apiUrl = (path: string) => {
  if (!sanitizedBase) return path;
  return `${sanitizedBase}${path.startsWith('/') ? path : `/${path}`}`;
};

export function apiFetch(input: string, init?: RequestInit) {
  return fetch(apiUrl(input), init);
}
