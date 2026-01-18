import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { assertDjtQuestServerEnv } from '../server/env-guard.js';
import { financeRequestCreateSchema } from '../server/finance/schema.js';
import { isGuestProfile } from '../server/finance/permissions.js';
import { clampLimit, parseBrlToCents, pickQueryParam, safeText, tryParseStorageFromPublicUrl } from '../server/finance/utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');

    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !ANON_KEY) return res.status(500).json({ error: 'Missing Supabase config' });

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
    const inputItems = Array.isArray((input as any).items) ? (input as any).items : [];
    const usingItems = inputItems.length > 0;

    const normalizeItemDescription = (v: any) =>
      safeText(v, 2000) || safeText(input.description, 2000) || '—';

    const normalizedItems: Array<{
      idx: number;
      expense_type: string;
      description: string;
      amount_cents: number | null;
      attachments: any[];
    }> = [];

    const flattenedAttachments: Array<{ itemIdx: number; att: any }> = [];

    if (usingItems) {
      if (inputItems.length > 12) {
        return res.status(400).json({ error: 'Máximo de 12 itens por solicitação.' });
      }

      for (let i = 0; i < inputItems.length; i += 1) {
        const it = inputItems[i] || {};
        const itemExpense = request_kind === 'Adiantamento' ? 'Adiantamento' : String(it?.expenseType || '').trim();
        const itemAmount = parseBrlToCents(it?.amountBrl) ?? null;
        const itemDesc = normalizeItemDescription(it?.description);
        const itemAttachments = request_kind === 'Adiantamento' ? [] : (Array.isArray(it?.attachments) ? it.attachments : []);

        normalizedItems.push({
          idx: i,
          expense_type: itemExpense,
          description: itemDesc,
          amount_cents: itemAmount,
          attachments: itemAttachments,
        });

        for (const a of itemAttachments) {
          flattenedAttachments.push({ itemIdx: i, att: a });
        }
      }
    } else {
      const legacyExpenseType = request_kind === 'Adiantamento' ? 'Adiantamento' : rawExpenseType;
      const legacyAttachments = request_kind === 'Adiantamento' ? [] : (Array.isArray(input.attachments) ? input.attachments : []);
      const legacyAmount = parseBrlToCents(input.amountBrl) ?? null;

      normalizedItems.push({
        idx: 0,
        expense_type: legacyExpenseType,
        description: normalizeItemDescription(null),
        amount_cents: request_kind === 'Adiantamento' ? legacyAmount : legacyAmount,
        attachments: legacyAttachments,
      });

      for (const a of legacyAttachments) {
        flattenedAttachments.push({ itemIdx: 0, att: a });
      }
    }

    if (flattenedAttachments.length > 12) {
      return res.status(400).json({ error: 'Máximo de 12 anexos por solicitação.' });
    }

    const distinctExpenseTypes = Array.from(
      new Set(
        normalizedItems
          .map((it) => String(it.expense_type || '').trim())
          .filter(Boolean)
          .filter((t) => t !== 'Adiantamento'),
      ),
    );

    const expense_type =
      request_kind === 'Adiantamento'
        ? 'Adiantamento'
        : usingItems
          ? (distinctExpenseTypes.length === 1 ? distinctExpenseTypes[0] : 'Múltiplos')
          : rawExpenseType;

    if (request_kind === 'Reembolso') {
      if (!expense_type || expense_type === 'Adiantamento') {
        return res.status(400).json({ error: 'Tipo obrigatório. Selecione o tipo do reembolso.' });
      }
      if (!flattenedAttachments.length) {
        return res.status(400).json({ error: 'Envie pelo menos 1 anexo.' });
      }
    }

    const totalAmount = normalizedItems.reduce((acc, it) => acc + (typeof it.amount_cents === 'number' ? it.amount_cents : 0), 0);
    const amount_cents =
      request_kind === 'Reembolso'
        ? (totalAmount > 0 ? totalAmount : null)
        : (totalAmount > 0 ? totalAmount : null);

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

    // Create items (best-effort; required for multi-item UX)
    let itemIdByIdx = new Map<number, string>();
    try {
      const itemsToInsert = normalizedItems.map((it) => ({
        request_id: requestId,
        idx: it.idx,
        expense_type: it.expense_type,
        description: it.description,
        amount_cents: it.amount_cents,
        currency: 'BRL',
        metadata: { source: usingItems ? 'multi_item_v1' : 'legacy_v1' },
      }));
      const { data: createdItems, error: itemErr } = await db
        .from('finance_request_items')
        .insert(itemsToInsert)
        .select('id,idx');

      if (itemErr) throw itemErr;
      for (const row of Array.isArray(createdItems) ? createdItems : []) {
        const idx = Number((row as any)?.idx);
        const id = String((row as any)?.id || '');
        if (Number.isFinite(idx) && id) itemIdByIdx.set(idx, id);
      }
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      try {
        await db.from('finance_requests').delete().eq('id', requestId);
      } catch {
        // ignore cleanup failure (RLS or transient)
      }
      if (msg.includes('finance_request_items') && msg.includes('does not exist')) {
        return res.status(503).json({ error: 'Migrations pendentes: aplique as migrations de finance_request_items antes de usar múltiplos itens.' });
      }
      // If items insertion fails, fail the request to avoid inconsistent multi-item data.
      return res.status(400).json({ error: msg || 'Falha ao criar itens da solicitação.' });
    }

    if (flattenedAttachments.length) {
      const toInsert = flattenedAttachments.map(({ itemIdx, att }) => {
        const url = String(att?.url || '').trim();
        const inferred = tryParseStorageFromPublicUrl({ supabaseUrl: SUPABASE_URL, url });
        const storage_bucket = safeText(att?.storageBucket, 80) || inferred.bucket;
        const storage_path = safeText(att?.storagePath, 600) || inferred.path;
        const baseMeta = att?.metadata && typeof att.metadata === 'object' ? att.metadata : {};
        const meta = { ...baseMeta, finance_item_idx: itemIdx };
        return {
          request_id: requestId,
          item_id: itemIdByIdx.get(itemIdx) || null,
          uploaded_by: uid,
          url,
          storage_bucket,
          storage_path,
          filename: safeText(att?.filename, 240),
          content_type: safeText(att?.contentType, 120),
          size_bytes: typeof att?.sizeBytes === 'number' ? att.sizeBytes : null,
          metadata: meta,
        };
      });
      let { error: attErr } = await db.from('finance_request_attachments').insert(toInsert);
      if (attErr && String(attErr.message || '').includes('item_id') && String(attErr.message || '').includes('does not exist')) {
        const fallback = toInsert.map(({ item_id, ...rest }) => rest);
        const retry = await db.from('finance_request_attachments').insert(fallback);
        attErr = retry.error as any;
      }
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
