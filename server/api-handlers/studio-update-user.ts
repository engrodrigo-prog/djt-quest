// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const normalizeSigla = (value?: string | null) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toUpperCase();
  return cleaned || null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase env configuration' });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader) return res.status(401).json({ error: 'No authorization header' });
    const token = authHeader.replace('Bearer ', '');

    const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

    // Permission check
    const callerId = userData.user.id;
    const { data: roles } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', callerId);
    const allowed = new Set(['gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx', 'admin']);
    let hasPermission = (roles || []).some((r: any) => allowed.has(r.role));
    if (!hasPermission) {
      // Fallback: allow leaders or profiles with studio_access
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('is_leader, studio_access')
        .eq('id', callerId)
        .maybeSingle();
      hasPermission = Boolean(callerProfile?.is_leader) || Boolean(callerProfile?.studio_access);
    }
    if (!hasPermission) return res.status(403).json({ error: 'Sem permissão' });

    const body = req.body || {};
    const { userId } = body as { userId?: string };
    if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });

    const updates: Record<string, unknown> = {};
    if (typeof body.name === 'string') updates.name = body.name;
    if (typeof body.email === 'string') updates.email = (body.email as string).toLowerCase();
    if (typeof body.matricula !== 'undefined') updates.matricula = body.matricula ?? null;
    if (typeof body.team_id !== 'undefined') updates.team_id = body.team_id ?? null;
    const hasSigla = Object.prototype.hasOwnProperty.call(body, 'sigla_area');
    const hasBase = Object.prototype.hasOwnProperty.call(body, 'operational_base');
    if (hasSigla) {
      const sigla = normalizeSigla(body.sigla_area);
      updates.sigla_area = sigla;
      updates.operational_base = sigla;
    } else if (hasBase) {
      const sigla = normalizeSigla(body.operational_base);
      updates.sigla_area = sigla;
      updates.operational_base = sigla;
    }
    if (typeof body.is_leader !== 'undefined') updates.is_leader = !!body.is_leader;
    if (typeof body.studio_access !== 'undefined') updates.studio_access = !!body.studio_access;
    if (typeof body.date_of_birth !== 'undefined') updates.date_of_birth = body.date_of_birth ?? null;

    // Update Auth if needed
    if (body.email || body.name) {
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        email: body.email,
        user_metadata: body.name ? { name: body.name } : undefined,
      });
      if (updErr) return res.status(400).json({ error: `Auth update failed: ${updErr.message}` });
    }

    if (Object.keys(updates).length > 0) {
      const { error: profErr } = await supabaseAdmin.from('profiles').update(updates).eq('id', userId);
      if (profErr) return res.status(400).json({ error: `Profile update failed: ${profErr.message}` });
    }

    if (body.role) {
      await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
      const { error: roleErr } = await supabaseAdmin.from('user_roles').insert({ user_id: userId, role: body.role });
      if (roleErr) return res.status(400).json({ error: `Role update failed: ${roleErr.message}` });
    }

    const { data: updated } = await supabaseAdmin
      .from('profiles')
      .select('id, email, name, matricula, team_id, operational_base, sigla_area, is_leader, studio_access')
      .eq('id', userId)
      .maybeSingle();

    return res.status(200).json({ success: true, profile: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
