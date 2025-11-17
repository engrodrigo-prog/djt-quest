// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const normalizeIdentifier = (value: string) => value.trim().toLowerCase();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Supabase credentials missing' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { identifier, reason } = req.body || {};
    if (!identifier || typeof identifier !== 'string') {
      return res.status(400).json({ error: 'Informe sua matrícula ou email' });
    }

    const cleanIdentifier = normalizeIdentifier(identifier);
    const upperIdentifier = identifier.trim().toUpperCase();

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, matricula, name')
      .or(`email.eq.${cleanIdentifier},matricula.eq.${upperIdentifier}`)
      .maybeSingle();

    if (profileError) return res.status(400).json({ error: profileError.message });
    if (!profile) return res.status(404).json({ error: 'Usuário não encontrado' });

    const { data: existing } = await supabase
      .from('password_reset_requests')
      .select('id')
      .eq('user_id', profile.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Já existe uma solicitação pendente para este usuário' });
    }

    const payload = {
      user_id: profile.id,
      identifier: identifier.trim(),
      reason: reason ? String(reason).trim() : null,
      status: 'pending',
    };

    const { error: insertError } = await supabase
      .from('password_reset_requests')
      .insert(payload);

    if (insertError) return res.status(400).json({ error: insertError.message });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unexpected error' });
  }
}
