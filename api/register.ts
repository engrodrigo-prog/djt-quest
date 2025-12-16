// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const PUBLIC_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) as string | undefined;

const GUEST_TEAM_ID = 'CONVIDADOS';
const REGISTRATION_TEAM_IDS = [
  'DJT',
  'DJT-PLAN',
  'DJTV',
  'DJTV-VOR',
  'DJTV-JUN',
  'DJTV-PJU',
  'DJTV-ITA',
  'DJTB',
  'DJTB-CUB',
  'DJTB-STO',
  GUEST_TEAM_ID,
] as const;

const ALLOWED_TEAMS = new Set(REGISTRATION_TEAM_IDS.map((t) => t.toUpperCase()));

const normText = (s: any, max = 120) =>
  String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);

const normEmail = (s: any) => normText(s, 255).toLowerCase();

const normMatricula = (s: any) => {
  const digits = String(s ?? '').replace(/\D/g, '').slice(0, 32);
  return digits || null;
};

const normTeam = (s: any) =>
  String(s ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);

const isGuestSigla = (sigla: string) => sigla === GUEST_TEAM_ID || sigla === 'EXTERNO';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    res.setHeader('Cache-Control', 'no-store');

    const key = SERVICE_ROLE_KEY || PUBLIC_KEY;
    if (!SUPABASE_URL || !key) return res.status(500).json({ error: 'Missing Supabase config' });
    const admin = createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });

    const body = (req.body && typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {};

    const name = normText(body.name, 100);
    const email = normEmail(body.email);
    const telefone = normText(body.telefone, 20) || null;
    const matricula = normMatricula(body.matricula);
    const siglaRaw = normTeam(body.sigla_area);
    const sigla = isGuestSigla(siglaRaw) ? GUEST_TEAM_ID : siglaRaw;
    const operationalBaseRaw = normText(body.operational_base, 100);
    const operational_base = sigla === GUEST_TEAM_ID ? GUEST_TEAM_ID : operationalBaseRaw;

    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
    if (!sigla) return res.status(400).json({ error: 'Equipe/Sigla é obrigatória' });
    if (!ALLOWED_TEAMS.has(sigla.toUpperCase())) return res.status(400).json({ error: 'Equipe/Sigla inválida' });
    if (!operational_base) return res.status(400).json({ error: 'Base operacional é obrigatória' });

    // If profile already exists for this email, do not create a pending request.
    const { data: existingProfile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existingProfile?.id) {
      return res.status(200).json({
        success: true,
        already_has_account: true,
      });
    }

    // Avoid duplicates: reuse (and update) the newest pending request for this email.
    const { data: pendingRows } = await admin
      .from('pending_registrations')
      .select('id, created_at')
      .eq('email', email)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(25);

    const payload: any = {
      name,
      email,
      telefone,
      matricula,
      operational_base,
      sigla_area: sigla,
      status: 'pending',
    };

    if (pendingRows && pendingRows.length > 0) {
      const keep = pendingRows[0];

      await admin.from('pending_registrations').update(payload).eq('id', keep.id);

      // Mark older duplicates as rejected (best effort).
      const dupIds = pendingRows.slice(1).map((r: any) => r.id).filter(Boolean);
      if (dupIds.length) {
        try {
          await admin
            .from('pending_registrations')
            .update({
              status: 'rejected',
              review_notes: 'Solicitação duplicada (mesmo e-mail). Mantida a mais recente.',
              reviewed_at: new Date().toISOString(),
            } as any)
            .in('id', dupIds as any);
        } catch {}
      }

      return res.status(200).json({ success: true, already_pending: true, id: keep.id });
    }

    const { data: inserted, error: insErr } = await admin
      .from('pending_registrations')
      .insert(payload)
      .select('id')
      .single();
    if (insErr) return res.status(400).json({ error: insErr.message });

    return res.status(200).json({ success: true, id: inserted?.id });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
