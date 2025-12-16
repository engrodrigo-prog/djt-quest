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
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);

const normTeamCode = (raw?: string | null) =>
  String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);

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
    const authHeader = (req.headers['authorization'] as string | undefined) || '';
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    if (!SUPABASE_URL) return res.status(500).json({ error: 'Missing SUPABASE_URL' });
    if (!SERVICE_ROLE_KEY && !PUBLIC_KEY) return res.status(500).json({ error: 'Missing Supabase key' });

    const useServiceRole = Boolean(SERVICE_ROLE_KEY);
    const admin = useServiceRole
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY as string, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : createClient(SUPABASE_URL, PUBLIC_KEY as string, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: authHeader } },
        });

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
        .select('team_id, coord_id, division_id, is_leader, studio_access, sigla_area, operational_base')
        .eq('id', requesterId)
        .maybeSingle(),
    ]);

    const roles = (rolesData || []).map((r: any) => String(r.role || ''));
    const isLeader = Boolean((profile as any)?.is_leader);
    const studioAccess = Boolean((profile as any)?.studio_access) || roles.some((r) => STAFF_ROLES.has(r)) || roles.includes('lider_equipe') || isLeader;
    if (!studioAccess) return res.status(403).json({ error: 'Insufficient permissions' });

    // Se estamos sem service role, pode faltar permissão para ler user_roles (RLS) e roles vir vazio.
    // Nessa situação, é melhor devolver "tudo que o próprio usuário consegue ver via RLS" do que
    // aplicar um filtro de escopo baseado em papel incompleto.
    const role = !useServiceRole && roles.length === 0 ? null : getEffectiveRole(roles, isLeader);
    // Se não identificamos um papel, mas o usuário tem studioAccess, devolve tudo (melhor visibilidade do que vazio).
    if (!role) {
      const { data, error } = await admin
        .from('pending_registrations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true, registrations: data || [] });
    }

    let teamId: string | null = (profile as any)?.team_id || null;
    if (!teamId) {
      const fallback = normTeamCode((profile as any)?.sigla_area || (profile as any)?.operational_base);
      teamId = fallback || null;
    }
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
