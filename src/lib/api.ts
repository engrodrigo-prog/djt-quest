import { supabase } from '@/integrations/supabase/client';

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

export async function apiFetch(input: string, init?: RequestInit) {
  const headers = new Headers(init?.headers || {});

  if (!headers.has('Authorization')) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    } catch {
      // Ignore errors fetching session; request proceeds unauthenticated
    }
  }

  return fetch(apiUrl(input), { ...init, headers });
}
