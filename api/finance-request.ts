import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { assertDjtQuestServerEnv, DJT_QUEST_SUPABASE_HOST } from '../server/env-guard.js';
import { financeRequestCancelSchema } from '../server/finance/schema.js';
import { canManageFinanceRequests, isGuestProfile } from '../server/finance/permissions.js';
import { pickQueryParam } from '../server/finance/utils.js';
import { getSupabaseUrlFromEnv } from '../server/lib/supabase-url.js';

const getSupabaseUrl = () =>
  getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true });

const getSupabaseAnonKey = () =>
  (process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    const SUPABASE_URL = getSupabaseUrl();
    const ANON_KEY = getSupabaseAnonKey();
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
    if (!SUPABASE_URL || !ANON_KEY) {
      return res.status(500).json({
        error: 'Missing Supabase config',
        missing: { supabaseUrl: !SUPABASE_URL, supabaseAnonKey: !ANON_KEY },
      });
    }

    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.slice(7);

    const authed = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const serviceAdmin = SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
      : null;
    const db = serviceAdmin || authed;

    const { data: userData, error: authErr } = await authed.auth.getUser();
    if (authErr) return res.status(401).json({ error: 'Unauthorized' });
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const [{ data: rolesRows }, { data: profile }] = await Promise.all([
      db.from('user_roles').select('role').eq('user_id', uid),
      db
        .from('profiles')
        .select('id,name,email,matricula,team_id,sigla_area,operational_base,is_leader')
        .eq('id', uid)
        .maybeSingle(),
    ]);
    const roles = Array.isArray(rolesRows) ? rolesRows.map((r: any) => String(r?.role || '')).filter(Boolean) : [];
    if (isGuestProfile(profile, roles)) {
      return res.status(403).json({ error: 'CONVIDADOS não podem acessar este módulo.' });
    }

    const id =
      (req.method === 'GET' ? pickQueryParam(req.query, 'id') : '') ||
      (req.body && typeof req.body.id === 'string' ? req.body.id : '');
    if (!id) return res.status(400).json({ error: 'id obrigatório' });

    const { data: reqRow } = await db
      .from('finance_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!reqRow) return res.status(404).json({ error: 'Solicitação não encontrada' });

    const canManage = canManageFinanceRequests(roles, profile);
    const isOwner = String(reqRow.created_by) === String(uid);
    if (!isOwner && !canManage) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET') {
      const [atts, hist] = await Promise.all([
        db
          .from('finance_request_attachments')
          .select('*')
          .eq('request_id', id)
          .order('created_at', { ascending: true }),
        db
          .from('finance_request_status_history')
          .select('*')
          .eq('request_id', id)
          .order('created_at', { ascending: true }),
      ]);
      return res.status(200).json({
        request: reqRow,
        attachments: Array.isArray(atts.data) ? atts.data : [],
        history: Array.isArray(hist.data) ? hist.data : [],
        permissions: { can_manage: canManage, can_cancel: isOwner && String(reqRow.status) === 'Enviado' },
      });
    }

    // PATCH cancel (owner only; status must be Enviado)
    const parsed = financeRequestCancelSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' });
    if (!isOwner) return res.status(403).json({ error: 'Somente o solicitante pode cancelar.' });
    if (String(reqRow.status) !== 'Enviado') return res.status(400).json({ error: 'Só é possível cancelar quando status = Enviado.' });

    const { error: updErr } = await db
      .from('finance_requests')
      .update({ status: 'Cancelado', last_observation: 'Cancelado pelo usuário' })
      .eq('id', id);
    if (updErr) return res.status(400).json({ error: updErr.message });

    await db.from('finance_request_status_history').insert({
      request_id: id,
      changed_by: uid,
      from_status: 'Enviado',
      to_status: 'Cancelado',
      observation: 'Cancelado pelo usuário',
    });

    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
