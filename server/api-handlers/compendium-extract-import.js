import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet } from '../lib/rbac.js';
import { parseCsvQuestions, parseXlsxQuestions, extractPdfText, extractPlainText } from '../lib/import-parsers.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx', 'content_curator']);
const LEADER_ROLES = new Set(['lider_equipe']);

const extOf = (p) => {
  const s = String(p || '');
  const i = s.lastIndexOf('.');
  if (i === -1) return '';
  return s.slice(i + 1).toLowerCase();
};

async function downloadToBuffer(admin, bucket, path) {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error) throw new Error(error.message);
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { data: rolesRows } = await admin.from('user_roles').select('role').eq('user_id', caller.id);
    const roleSet = rolesToSet(rolesRows);
    const { data: profile } = await admin
      .from('profiles')
      .select('studio_access, is_leader')
      .eq('id', caller.id)
      .maybeSingle();

    const allowed =
      Boolean(profile?.studio_access) ||
      Boolean(profile?.is_leader) ||
      Array.from(roleSet).some((r) => STAFF_ROLES.has(r) || LEADER_ROLES.has(r));
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const { importId, purpose } = req.body || {};
    const id = String(importId || '').trim();
    if (!id) return res.status(400).json({ error: 'importId required' });
    const importPurpose = purpose != null ? String(purpose).trim() : '';

    const { data: imp, error: impErr } = await admin.from('content_imports').select('*').eq('id', id).maybeSingle();
    if (impErr) return res.status(400).json({ error: impErr.message });
    if (!imp) return res.status(404).json({ error: 'Import not found' });

    const bucket = String(imp.source_bucket || 'quiz-imports');
    const path = String(imp.source_path || '');
    const mime = String(imp.source_mime || '');

    const buf = await downloadToBuffer(admin, bucket, path);
    const ext = extOf(path);

    let raw_extract = null;
    if (ext === 'csv' || mime.includes('csv')) {
      const parsed = parseCsvQuestions(buf);
      raw_extract = { kind: 'csv', ...(importPurpose ? { purpose: importPurpose } : {}), ...parsed };
    } else if (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheet')) {
      const parsed = parseXlsxQuestions(buf);
      raw_extract = { kind: 'xlsx', ...(importPurpose ? { purpose: importPurpose } : {}), ...parsed };
    } else if (ext === 'pdf' || mime.includes('pdf')) {
      const text = await extractPdfText(buf);
      raw_extract = { kind: 'pdf', ...(importPurpose ? { purpose: importPurpose } : {}), text };
    } else if (ext === 'txt' || mime.includes('text/plain')) {
      const text = extractPlainText(buf);
      raw_extract = { kind: 'txt', ...(importPurpose ? { purpose: importPurpose } : {}), text };
    } else {
      return res.status(400).json({ error: `Formato não suportado: ${ext || mime || 'unknown'}` });
    }

    const { data: updated, error: updErr } = await admin
      .from('content_imports')
      .update({ status: 'EXTRACTED', raw_extract })
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) return res.status(400).json({ error: updErr.message });

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'compendium.import.extract',
      entity_type: 'content_import',
      entity_id: id,
      before_json: { status: imp.status },
      after_json: { status: updated.status, kind: raw_extract?.kind, purpose: importPurpose || null },
    });

    return res.status(200).json({ success: true, import: updated });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

