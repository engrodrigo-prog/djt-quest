import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { assertDjtQuestServerEnv, DJT_QUEST_SUPABASE_HOST } from '../server/env-guard.js';
import { financeRequestCreateSchema } from '../server/finance/schema.js';
import { isGuestProfile } from '../server/finance/permissions.js';
import { clampLimit, parseBrlToCents, pickQueryParam, safeText, tryParseStorageFromPublicUrl } from '../server/finance/utils.js';
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
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      return res.status(403).json({ error: 'CONVIDADOS não podem solicitar reembolso/adiantamento.' });
    }

    if (req.method === 'GET') {
      const status = safeText(pickQueryParam(req.query, 'status'), 40);
      const kind = safeText(pickQueryParam(req.query, 'request_kind'), 40);
      const limit = clampLimit(pickQueryParam(req.query, 'limit'), 60, 200);

      let q = db
        .from('finance_requests')
        .select(
          'id,protocol,created_at,updated_at,company,training_operational,request_kind,expense_type,coordination,date_start,date_end,amount_cents,currency,status,last_observation',
        )
        .eq('created_by', uid)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (status && status !== 'all') q = q.eq('status', status);
      if (kind && kind !== 'all') q = q.eq('request_kind', kind);
      const { data } = await q;
      return res.status(200).json({ items: Array.isArray(data) ? data : [] });
    }

    // POST create
    const parsed = financeRequestCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    const input = parsed.data;

    const request_kind = String(input.requestKind);
    const rawExpenseType = String(input.expenseType || '').trim();
    const expense_type = request_kind === 'Adiantamento' ? 'Adiantamento' : rawExpenseType;
    if (request_kind === 'Reembolso' && !expense_type) {
      return res.status(400).json({ error: 'Tipo obrigatório. Selecione o tipo do reembolso.' });
    }

    const attachments = Array.isArray(input.attachments) ? input.attachments : [];
    if (request_kind === 'Reembolso' && attachments.length < 1) {
      return res.status(400).json({ error: 'Envie pelo menos 1 anexo.' });
    }
    if (attachments.length > 12) {
      return res.status(400).json({ error: 'Máximo de 12 anexos por solicitação.' });
    }

    const amount_cents = request_kind === 'Adiantamento' ? null : parseBrlToCents(input.amountBrl) ?? null;
    if (request_kind === 'Reembolso' && (!amount_cents || amount_cents <= 0)) {
      return res.status(400).json({ error: 'Valor inválido. Use um valor em R$ (ex.: 123,45 ou 1.234,56).' });
    }

    const insertPayload: any = {
      created_by: uid,
      created_by_name: safeText(profile?.name, 200) || userData?.user?.email || null,
      created_by_email: safeText(profile?.email || userData?.user?.email, 200) || null,
      created_by_matricula: safeText(profile?.matricula, 80),
      company: input.company,
      training_operational: Boolean(input.trainingOperational),
      request_kind,
      expense_type,
      coordination: input.coordination,
      date_start: input.dateStart,
      date_end: input.dateEnd || null,
      description: input.description,
      amount_cents,
      currency: 'BRL',
      status: 'Enviado',
      last_observation: null,
    };

    const { data: created, error: createErr } = await db
      .from('finance_requests')
      .insert(insertPayload)
      .select('id,protocol,status')
      .single();
    if (createErr) return res.status(400).json({ error: createErr.message });
    const requestId = String(created?.id || '');
    if (!requestId) return res.status(500).json({ error: 'Falha ao criar solicitação' });

    if (attachments.length) {
      const toInsert = attachments.map((a) => {
        const url = String(a?.url || '').trim();
        const inferred = tryParseStorageFromPublicUrl({ supabaseUrl: SUPABASE_URL, url });
        const storage_bucket = safeText(a?.storageBucket, 80) || inferred.bucket;
        const storage_path = safeText(a?.storagePath, 600) || inferred.path;
        return {
          request_id: requestId,
          uploaded_by: uid,
          url,
          storage_bucket,
          storage_path,
          filename: safeText(a?.filename, 240),
          content_type: safeText(a?.contentType, 120),
          size_bytes: typeof a?.sizeBytes === 'number' ? a.sizeBytes : null,
          metadata: a?.metadata && typeof a.metadata === 'object' ? a.metadata : {},
        };
      });
      const { error: attErr } = await db.from('finance_request_attachments').insert(toInsert);
      if (attErr) {
        try {
          await db.from('finance_requests').delete().eq('id', requestId);
        } catch {
          // ignore cleanup failure
        }
        return res.status(400).json({ error: attErr.message });
      }
    }

    // initial history
    const { error: histErr } = await db.from('finance_request_status_history').insert({
      request_id: requestId,
      changed_by: uid,
      from_status: null,
      to_status: 'Enviado',
      observation: null,
    });
    // If history insert fails due to missing policy/service role, don't fail the request creation.
    if (histErr) {
      // best-effort: keep request as created; history can be reconstructed by staff if needed.
    }

    return res.status(200).json({ success: true, request: created });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
