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
  'DJTV-VOT',
  'DJTV-JUN',
  'DJTV-PJU',
  'DJTV-ITA',
  'DJTB',
  'DJTB-CUB',
  'DJTB-SAN',
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

const canonicalizeSiglaArea = (raw: string) => {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return s;
  if (s === 'DJT-PLA') return 'DJT-PLAN';
  if (s === 'DJTV-VOR') return 'DJTV-VOT';
  if (s === 'DJTB-STO') return 'DJTB-SAN';
  if (s === 'DJTV-ITP') return 'DJTV-ITA';
  return s;
};

const normRequestedProfile = (raw: any) => {
  const s = normText(raw, 32).toLowerCase();
  if (!s) return null;
  if (s === 'guest' || s === 'convidado' || s === 'invited') return 'guest';
  if (s === 'leader' || s === 'lider' || s === 'líder' || s === 'lider_equipe') return 'leader';
  if (s === 'collaborator' || s === 'colaborador' || s === 'colab') return 'collaborator';
  return null;
};

const normDob = (raw: any) => {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (d > todayUtc) return null;
  return s;
};

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
    const date_of_birth = normDob(body.date_of_birth);
    const telefone = normText(body.telefone, 20) || null;
    const matricula = normMatricula(body.matricula);
    const requested_profile = normRequestedProfile(body.requested_profile);
    const siglaRaw = normTeam(body.sigla_area);
    const sigla = isGuestSigla(siglaRaw) ? GUEST_TEAM_ID : canonicalizeSiglaArea(siglaRaw);
    const operationalBaseRaw = normText(body.operational_base, 100);
    const forcedGuest = requested_profile === 'guest';
    const operational_base = forcedGuest || sigla === GUEST_TEAM_ID ? GUEST_TEAM_ID : operationalBaseRaw;
    const effectiveSigla = forcedGuest ? GUEST_TEAM_ID : sigla;

    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
    if (!date_of_birth) return res.status(400).json({ error: 'Data de nascimento é obrigatória' });
    if (!effectiveSigla) return res.status(400).json({ error: 'Equipe/Sigla é obrigatória' });
    if (!ALLOWED_TEAMS.has(effectiveSigla.toUpperCase())) return res.status(400).json({ error: 'Equipe/Sigla inválida' });
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
      date_of_birth,
      telefone,
      matricula,
      operational_base,
      sigla_area: effectiveSigla,
      ...(requested_profile ? { requested_profile } : {}),
      status: 'pending',
    };

    const shouldRetryWithoutRequestedProfile = (err: any) => {
      const msg = String(err?.message || '').toLowerCase();
      const code = String(err?.code || '');
      return (code === '42703' || msg.includes('requested_profile')) && (msg.includes('column') || msg.includes('does not exist'));
    };

    if (pendingRows && pendingRows.length > 0) {
      const keep = pendingRows[0];

      const upd = await admin.from('pending_registrations').update(payload).eq('id', keep.id);
      if (upd.error && payload.requested_profile && shouldRetryWithoutRequestedProfile(upd.error)) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.requested_profile;
        const upd2 = await admin.from('pending_registrations').update(fallbackPayload).eq('id', keep.id);
        if (upd2.error) return res.status(400).json({ error: upd2.error.message });
      } else if (upd.error) {
        return res.status(400).json({ error: upd.error.message });
      }

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

    let insertRes = await admin.from('pending_registrations').insert(payload).select('id').single();
    if (insertRes.error && payload.requested_profile && shouldRetryWithoutRequestedProfile(insertRes.error)) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.requested_profile;
      insertRes = await admin.from('pending_registrations').insert(fallbackPayload).select('id').single();
    }
    if (insertRes.error) return res.status(400).json({ error: insertRes.error.message });

    return res.status(200).json({ success: true, id: insertRes.data?.id });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
