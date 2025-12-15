// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type RejectRequest = { registrationId: string; notes: string };

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

const GUEST_TEAM_ID = 'CONVIDADOS';

const normTeamCode = (raw?: string | null) =>
  String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);

const computeScope = async (admin: any, userId: string) => {
  const [{ data: rolesData }, { data: profile }] = await Promise.all([
    admin.from('user_roles').select('role').eq('user_id', userId),
    admin.from('profiles').select('team_id, coord_id, division_id, is_leader, studio_access, sigla_area, operational_base').eq('id', userId).maybeSingle(),
  ]);

  const roles = (rolesData || []).map((r: any) => String(r.role || ''));
  const isLeader = Boolean((profile as any)?.is_leader);
  const roleSet = new Set(roles);

  let effectiveRole: string | null = null;
  if (roleSet.has('admin')) effectiveRole = 'admin';
  else if (roleSet.has('gerente_djt')) effectiveRole = 'gerente_djt';
  else if (roleSet.has('gerente_divisao_djtx')) effectiveRole = 'gerente_divisao_djtx';
  else if (roleSet.has('coordenador_djtx')) effectiveRole = 'coordenador_djtx';
  else if (roleSet.has('lider_equipe') || isLeader) effectiveRole = 'lider_equipe';

  const studioAccess =
    Boolean((profile as any)?.studio_access) ||
    roleSet.has('admin') ||
    roleSet.has('gerente_djt') ||
    roleSet.has('gerente_divisao_djtx') ||
    roleSet.has('coordenador_djtx') ||
    roleSet.has('lider_equipe') ||
    isLeader;

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

  return { roles, isLeader, studioAccess, effectiveRole, teamId, coordId, divisionId };
};

const inScope = (regSiglaRaw: string, scope: any) => {
  const sigla = String(regSiglaRaw || '').toUpperCase();
  if (!sigla) return false;
  if (sigla === GUEST_TEAM_ID) return true;

  const div = String(scope.divisionId || '').toUpperCase();
  const coord = String(scope.coordId || '').toUpperCase();
  const team = String(scope.teamId || '').toUpperCase();

  if (scope.effectiveRole === 'admin' || scope.effectiveRole === 'gerente_djt') return true;
  if (scope.effectiveRole === 'gerente_divisao_djtx') return !!div && sigla.startsWith(div);
  if (scope.effectiveRole === 'coordenador_djtx')
    return (!!div && sigla.startsWith(div)) || (!!coord && sigla.startsWith(coord)) || (!!team && sigla === team);
  if (scope.effectiveRole === 'lider_equipe') return !!team && sigla === team;
  return false;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const scope = await computeScope(admin, requesterId);
    if (!scope.studioAccess || !scope.effectiveRole) return res.status(403).json({ error: 'Insufficient permissions' });

    const body = (req.body || {}) as RejectRequest;
    if (!body?.registrationId) return res.status(400).json({ error: 'registrationId required' });
    if (!body?.notes) return res.status(400).json({ error: 'notes required' });

    const { data: reg, error: regErr } = await admin
      .from('pending_registrations')
      .select('*')
      .eq('id', body.registrationId)
      .eq('status', 'pending')
      .single();
    if (regErr || !reg) return res.status(404).json({ error: 'Registration not found or processed' });

    if (!inScope(reg.sigla_area, scope)) return res.status(403).json({ error: 'Fora do escopo' });

    const { error: updErr } = await admin
      .from('pending_registrations')
      .update({
        status: 'rejected',
        reviewed_by: requesterId,
        reviewed_at: new Date().toISOString(),
        review_notes: body.notes,
      })
      .eq('id', body.registrationId);
    if (updErr) return res.status(400).json({ error: updErr.message });

    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
