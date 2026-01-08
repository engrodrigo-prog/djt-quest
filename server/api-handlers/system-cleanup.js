import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { rolesToSet, canManageUsers, ROLE } from '../lib/rbac.js';

const TEST_EMAIL_PATTERNS = [
  '%@djtquest%',
  '%@test%',
  '%@exemplo%',
  '%@example%',
];

const uniq = (arr) => Array.from(new Set((arr || []).map((s) => String(s || '').trim()).filter(Boolean)));

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const [{ data: rolesRows }, { data: callerProfile }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', caller.id),
      admin.from('profiles').select('is_leader, studio_access').eq('id', caller.id).maybeSingle(),
    ]);
    const roleSet = rolesToSet(rolesRows);

    const isLeaderFlag = Boolean(callerProfile?.is_leader) || roleSet.has(ROLE.TEAM_LEADER);
    const hasPermission = canManageUsers({ roleSet, profile: callerProfile }) || isLeaderFlag;
    if (!hasPermission) return res.status(403).json({ error: 'Sem permissão' });

    const body = req.body || {};
    const action = String(body.action || '').trim();
    const dryRun = body.dryRun !== undefined ? Boolean(body.dryRun) : true;

    if (action === 'purge-pending-registrations') {
      const olderThanDaysRaw = Number.isFinite(Number(body.olderThanDays)) ? Number(body.olderThanDays) : 30;
      const olderThanDays = Math.max(0, olderThanDaysRaw);
      const statuses = uniq(Array.isArray(body.statuses) ? body.statuses : ['pending', 'rejected']);
      const cutoff = olderThanDays > 0
        ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      let countQuery = admin
        .from('pending_registrations')
        .select('id', { count: 'exact', head: true })
        .in('status', statuses);
      if (cutoff) countQuery = countQuery.lt('created_at', cutoff);
      const { count: toDeleteCount } = await countQuery;

      if (dryRun) {
        return res.status(200).json({ success: true, dryRun: true, deleteCount: toDeleteCount || 0, cutoff, statuses });
      }

      let delQuery = admin
        .from('pending_registrations')
        .delete()
        .in('status', statuses);
      if (cutoff) delQuery = delQuery.lt('created_at', cutoff);
      const { error: delErr } = await delQuery;
      if (delErr) return res.status(400).json({ error: delErr.message });

      return res.status(200).json({ success: true, dryRun: false, deleted: toDeleteCount || 0, cutoff, statuses });
    }

    if (action === 'purge-test-users') {
      const limit = Number.isFinite(Number(body.limit)) ? Math.min(500, Math.max(1, Number(body.limit))) : 200;

      const clauses = TEST_EMAIL_PATTERNS.map((p) => `email.ilike.${p}`).join(',');
      const { data: profiles, error } = await admin
        .from('profiles')
        .select('id, email, name, created_at')
        .or(clauses)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return res.status(400).json({ error: error.message });

      const list = (profiles || []).map((p) => ({
        id: p.id,
        email: p.email || null,
        name: p.name || null,
        created_at: p.created_at || null,
      }));

      if (dryRun) {
        return res.status(200).json({ success: true, dryRun: true, found: list.length, sample: list.slice(0, 20) });
      }

      let deleted = 0;
      const errors = [];
      for (const p of list) {
        try {
          await admin.auth.admin.deleteUser(p.id);
          deleted++;
        } catch (e) {
          errors.push({ id: p.id, email: p.email, error: e?.message || 'delete failed' });
        }
      }

      const emails = list.map((p) => p.email).filter(Boolean);
      if (emails.length) {
        try {
          await admin.from('pending_registrations').delete().in('email', emails);
        } catch {
          // ignore
        }
      }

      return res.status(200).json({ success: true, dryRun: false, deleted, errors });
    }

    if (action === 'purge-voice-transcribe') {
      const bucket = 'forum-attachments';
      const prefix = 'voice-transcribe';
      const maxDelete = Number.isFinite(Number(body.maxDelete)) ? Math.min(5000, Math.max(1, Number(body.maxDelete))) : 1000;

      const toRemove = [];
      // List user folders under voice-transcribe/
      const { data: roots, error: rootErr } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
      if (rootErr) return res.status(400).json({ error: rootErr.message });

      const folders = (roots || [])
        .filter((it) => it?.name && !it?.id) // folders usually have no id
        .map((it) => String(it.name));

      // Also include any files directly under the prefix
      for (const it of roots || []) {
        if (it?.id && it?.name) toRemove.push(`${prefix}/${it.name}`);
      }

      for (const folder of folders) {
        if (toRemove.length >= maxDelete) break;
        const sub = `${prefix}/${folder}`;
        const { data: files, error: listErr } = await admin.storage.from(bucket).list(sub, { limit: 1000 });
        if (listErr) continue;
        for (const f of files || []) {
          if (toRemove.length >= maxDelete) break;
          if (f?.id && f?.name) toRemove.push(`${sub}/${f.name}`);
        }
      }

      if (dryRun) {
        return res.status(200).json({ success: true, dryRun: true, found: toRemove.length, sample: toRemove.slice(0, 30) });
      }

      let removed = 0;
      const errors = [];
      for (let i = 0; i < toRemove.length; i += 1000) {
        const batch = toRemove.slice(i, i + 1000);
        const { error: remErr } = await admin.storage.from(bucket).remove(batch);
        if (remErr) errors.push({ batch: i / 1000, error: remErr.message });
        else removed += batch.length;
      }

      return res.status(200).json({ success: true, dryRun: false, removed, errors });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
