import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { assertDjtQuestServerEnv, DJT_QUEST_SUPABASE_HOST } from '../server/env-guard.js';
import { financeRequestAdminUpdateSchema } from '../server/finance/schema.js';
import { canManageFinanceRequests, isGuestProfile } from '../server/finance/permissions.js';
import { normalizeFinanceStatus } from '../server/finance/constants.js';
import { clampLimit, pickQueryParam, safeText } from '../server/finance/utils.js';
import * as XLSX from 'xlsx';
import { getSupabaseUrlFromEnv } from '../server/lib/supabase-url.js';

const getSupabaseUrl = () =>
  getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true });

const getSupabaseAnonKey = () =>
  (process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string;

const toCsv = (rows: any[]) => {
  const header = [
    'protocol',
    'created_at',
    'updated_at',
    'created_by_name',
    'created_by_email',
    'created_by_matricula',
    'company',
    'training_operational',
    'request_kind',
    'expense_type',
    'coordination',
    'date_start',
    'date_end',
    'amount_brl',
    'status',
    'last_observation',
  ];
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    const amount = typeof r.amount_cents === 'number' ? (r.amount_cents / 100).toFixed(2).replace('.', ',') : '';
    lines.push(
      [
        r.protocol,
        r.created_at,
        r.updated_at,
        r.created_by_name,
        r.created_by_email,
        r.created_by_matricula,
        r.company,
        r.training_operational ? 'Sim' : 'Não',
        r.request_kind,
        r.expense_type,
        r.coordination,
        r.date_start,
        r.date_end,
        amount,
        r.status,
        r.last_observation,
      ].map(esc).join(','),
    );
  }
  return lines.join('\n');
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // This endpoint is used for near-real-time dashboards and exports; never cache it.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');

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
    const admin = SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
      : null;
    const db = admin || authed;

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
    if (isGuestProfile(profile, roles)) return res.status(403).json({ error: 'Forbidden' });

    const canManage = canManageFinanceRequests(roles, profile);
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'PATCH') {
      const parsed = financeRequestAdminUpdateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      const { id, status, observation } = parsed.data;

      const { data: reqRow } = await db
        .from('finance_requests')
        .select('id,status')
        .eq('id', id)
        .maybeSingle();
      if (!reqRow) return res.status(404).json({ error: 'Solicitação não encontrada' });

      const from_status = String(reqRow.status || '');
      const to_status = String(status);

      const { error: updErr } = await db
        .from('finance_requests')
        .update({ status: to_status, last_observation: safeText(observation, 2000) })
        .eq('id', id);
      if (updErr) return res.status(400).json({ error: updErr.message });

      await db.from('finance_request_status_history').insert({
        request_id: id,
        changed_by: uid,
        from_status,
        to_status,
        observation: safeText(observation, 2000),
      });

      return res.status(200).json({ success: true });
    }

    // GET list / export
    const exportFmt = String(pickQueryParam(req.query, 'export') || '').trim().toLowerCase();
    const limit = clampLimit(pickQueryParam(req.query, 'limit'), 120, 500);
    const company = safeText(pickQueryParam(req.query, 'company'), 80);
    const coordination = safeText(pickQueryParam(req.query, 'coordination'), 80);
    const request_kind = safeText(pickQueryParam(req.query, 'request_kind'), 40);
    const statusRaw = safeText(pickQueryParam(req.query, 'status'), 40);
    const status = statusRaw ? normalizeFinanceStatus(statusRaw) : null;
    const q = safeText(pickQueryParam(req.query, 'q'), 200);
    const dateFromRaw = safeText(pickQueryParam(req.query, 'date_start_from'), 30);
    const dateToRaw = safeText(pickQueryParam(req.query, 'date_start_to'), 30);
    const isIsoDate = (s?: string | null) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)));
    const dateFrom = isIsoDate(dateFromRaw) ? String(dateFromRaw) : '';
    const dateTo = isIsoDate(dateToRaw) ? String(dateToRaw) : '';
    if (dateFromRaw && !dateFrom) return res.status(400).json({ error: 'date_start_from inválido (use AAAA-MM-DD)' });
    if (dateToRaw && !dateTo) return res.status(400).json({ error: 'date_start_to inválido (use AAAA-MM-DD)' });
    if (dateFrom && dateTo && dateTo < dateFrom) {
      return res.status(400).json({ error: 'date_start_to deve ser >= date_start_from' });
    }

    let query = db
      .from('finance_requests')
      .select(
        'id,protocol,created_at,updated_at,created_by,created_by_name,created_by_email,created_by_matricula,company,training_operational,request_kind,expense_type,coordination,date_start,date_end,amount_cents,currency,status,last_observation',
      )
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (company && company !== 'all') query = query.eq('company', company);
    if (coordination && coordination !== 'all') query = query.eq('coordination', coordination);
    if (request_kind && request_kind !== 'all') query = query.eq('request_kind', request_kind);
    if (status && status !== 'all') query = query.eq('status', status);
    if (dateFrom) query = query.gte('date_start', dateFrom);
    if (dateTo) query = query.lte('date_start', dateTo);
    if (q) {
      const needle = q.replace(/[%_]/g, '\\$&');
      query = query.or(`created_by_name.ilike.%${needle}%,created_by_email.ilike.%${needle}%`);
    }

    const { data } = await query;
    const rows = Array.isArray(data) ? data : [];

    if (exportFmt === 'xlsx') {
      const sheetRows = rows.map((r) => ({
        Protocolo: r.protocol,
        CriadoEm: r.created_at,
        AtualizadoEm: r.updated_at,
        Nome: r.created_by_name,
        Email: r.created_by_email,
        Matricula: r.created_by_matricula,
        Empresa: r.company,
        TreinamentoOperacional: r.training_operational ? 'Sim' : 'Não',
        TipoSolicitacao: r.request_kind,
        Tipo: r.expense_type,
        Coordenacao: r.coordination,
        DataInicio: r.date_start,
        DataFim: r.date_end,
        Valor: typeof r.amount_cents === 'number' ? r.amount_cents / 100 : null,
        Status: r.status,
        Observacao: r.last_observation,
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Solicitacoes');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as any;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="finance-requests.xlsx"');
      return res.status(200).send(buf);
    }

    if (exportFmt === 'csv') {
      const csv = toCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="finance-requests.csv"');
      return res.status(200).send(csv);
    }

    return res.status(200).json({ items: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
