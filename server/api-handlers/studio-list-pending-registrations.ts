// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

const GUEST_TEAM_ID = 'CONVIDADOS';
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);

const getEffectiveRole = (roles: string[], isLeader: boolean) => {
  const set = new Set(roles);
  if (set.has('admin')) return 'admin';
  if (set.has('gerente_djt')) return 'gerente_djt';
  if (set.has('gerente_divisao_djtx')) return 'gerente_divisao_djtx';
  if (set.has('coordenador_djtx')) return 'coordenador_djtx';
  if (set.has('lider_equipe') || isLeader) return 'lider_equipe';
  return null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = (req.headers['authorization'] as string | undefined) || '';
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    let requesterId: string | null = null;
    try {
      const { data } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
      requesterId = data.user?.id || null;
    } catch {}
    if (!requesterId) return res.status(401).json({ error: 'Unauthorized' });

    const [{ data: rolesData }, { data: profile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', requesterId),
      admin
        .from('profiles')
        .select('team_id, coord_id, division_id, is_leader, studio_access')
        .eq('id', requesterId)
        .maybeSingle(),
    ]);

    const roles = (rolesData || []).map((r: any) => String(r.role || ''));
    const isLeader = Boolean((profile as any)?.is_leader);
    const studioAccess = Boolean((profile as any)?.studio_access) || roles.some((r) => STAFF_ROLES.has(r)) || roles.includes('lider_equipe') || isLeader;
    if (!studioAccess) return res.status(403).json({ error: 'Insufficient permissions' });

    const role = getEffectiveRole(roles, isLeader);
    if (!role) return res.status(200).json({ success: true, registrations: [] });

    let teamId: string | null = (profile as any)?.team_id || null;
    let coordId: string | null = (profile as any)?.coord_id || null;
    let divisionId: string | null = (profile as any)?.division_id || null;

    if (teamId && !coordId) {
      try {
        const { data } = await admin.from('teams').select('coord_id').eq('id', teamId).maybeSingle();
        coordId = (data as any)?.coord_id || null;
      } catch {}
    }
    if (coordId && !divisionId) {
      try {
        const { data } = await admin.from('coordinations').select('division_id').eq('id', coordId).maybeSingle();
        divisionId = (data as any)?.division_id || null;
      } catch {}
    }

    let q: any = admin.from('pending_registrations').select('*').order('created_at', { ascending: false }).limit(500);

    const ors: string[] = [];
    if (role === 'admin' || role === 'gerente_djt') {
      // no filter
    } else if (role === 'gerente_divisao_djtx') {
      if (divisionId) ors.push(`sigla_area.ilike.${divisionId}%`);
      ors.push(`sigla_area.eq.${GUEST_TEAM_ID}`);
      q = q.or(ors.join(','));
    } else if (role === 'coordenador_djtx') {
      if (divisionId) ors.push(`sigla_area.ilike.${divisionId}%`);
      if (coordId) ors.push(`sigla_area.ilike.${coordId}%`);
      if (teamId) ors.push(`sigla_area.eq.${teamId}`);
      ors.push(`sigla_area.eq.${GUEST_TEAM_ID}`);
      q = q.or(ors.join(','));
    } else if (role === 'lider_equipe') {
      if (teamId) ors.push(`sigla_area.eq.${teamId}`);
      ors.push(`sigla_area.eq.${GUEST_TEAM_ID}`);
      q = q.or(ors.join(','));
    }

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ success: true, registrations: data || [] });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };

