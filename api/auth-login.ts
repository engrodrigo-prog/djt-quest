// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = (process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL) as string;

const PUBLIC_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) as string | undefined;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Cache-Control': 'no-store, max-age=0',
};

const normEmail = (s: any) => String(s ?? '').trim().toLowerCase().slice(0, 255);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).setHeader('Cache-Control', 'no-store').send('');
  if (req.method !== 'POST') return res.status(405).setHeader('Cache-Control', 'no-store').json({ error: 'Method not allowed' });

  try {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v as any));

    if (!SUPABASE_URL || !PUBLIC_KEY) return res.status(500).json({ error: 'Missing Supabase config' });

    const body = (req.body && typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {};
    const email = normEmail(body.email);
    const password = String(body.password ?? '');

    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
    if (!password || password.length < 1) return res.status(400).json({ error: 'Senha inválida' });

    const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`;

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: PUBLIC_KEY,
        authorization: `Bearer ${PUBLIC_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const text = await upstream.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!upstream.ok) {
      const msg =
        payload?.msg ||
        payload?.message ||
        payload?.error_description ||
        payload?.error ||
        `Auth upstream error (${upstream.status})`;
      return res.status(upstream.status).json({ error: String(msg) });
    }

    // Return only what's needed for client-side setSession.
    return res.status(200).json({
      access_token: payload?.access_token,
      refresh_token: payload?.refresh_token,
      expires_in: payload?.expires_in,
      token_type: payload?.token_type,
      user: payload?.user,
    });
  } catch (e: any) {
    return res.status(500).setHeader('Cache-Control', 'no-store').json({ error: e?.message || 'Unexpected error' });
  }
}
