import { createClient } from '@supabase/supabase-js';

const getSupabaseUrl = () =>
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';

export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function getBearerToken(req) {
  const auth = req?.headers?.authorization || req?.headers?.Authorization || '';
  const s = Array.isArray(auth) ? auth[0] : auth;
  if (!s || typeof s !== 'string') return null;
  if (!s.startsWith('Bearer ')) return null;
  return s.slice(7);
}

export async function requireCallerUser(admin, req) {
  const token = getBearerToken(req);
  if (!token) throw new Error('Unauthorized');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error('Unauthorized');
  return data.user;
}

