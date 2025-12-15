// @ts-nocheck
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Whitelist hard: somente estes usuários podem ajustar XP manualmente
const ALLOWED_EMAILS = new Set([
  'rodrigonasc@cpfl.com.br',
  'cveiga@cpfl.com.br',
  'rodrigoalmeida@cpfl.com.br',
  'paulo.camara@cpfl.com.br',
]);
const ALLOWED_MATRICULAS = new Set(['601555', '3005597', '866776', '2011902']);

const clampInt = (n, min, max) => {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase config' });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });
    const actorId = userData.user.id;

    const { data: actorProfile } = await admin
      .from('profiles')
      .select('id, email, matricula')
      .eq('id', actorId)
      .maybeSingle();

    const actorEmail = String(actorProfile?.email || userData.user.email || '').toLowerCase().trim();
    const actorMatricula = String(actorProfile?.matricula || '').trim();
    const allowed = ALLOWED_EMAILS.has(actorEmail) || ALLOWED_MATRICULAS.has(actorMatricula);
    if (!allowed) return res.status(403).json({ error: 'Sem permissão para ajustar XP manualmente.' });

    const { action, user_id, matricula, xp } = req.body || {};
    const actionNorm = String(action || '').trim().toLowerCase();
    const isReset = actionNorm === 'reset' || actionNorm === 'zerar';
    const isSet = actionNorm === 'set' || actionNorm === 'definir';
    if (!isReset && !isSet) {
      return res.status(400).json({ error: "action inválida (use 'set' ou 'reset')." });
    }

    let targetUserId = (user_id ? String(user_id) : '').trim() || null;
    if (!targetUserId && matricula) {
      const m = String(matricula).trim();
      const { data: target } = await admin.from('profiles').select('id').eq('matricula', m).maybeSingle();
      targetUserId = target?.id || null;
    }
    if (!targetUserId) return res.status(400).json({ error: 'Informe user_id ou matricula.' });

    const xpToSetRaw = isReset ? 0 : Number(xp);
    if (!isReset && !Number.isFinite(xpToSetRaw)) {
      return res.status(400).json({ error: 'xp inválido.' });
    }
    const xpToSet = clampInt(xpToSetRaw, 0, 1_000_000);

    const { data: targetProfile, error: targetErr } = await admin
      .from('profiles')
      .select('id, name, email, matricula, xp, tier')
      .eq('id', targetUserId)
      .maybeSingle();
    if (targetErr || !targetProfile) return res.status(404).json({ error: 'Usuário alvo não encontrado.' });

    const currentTier = targetProfile.tier;
    const { data: tierData, error: tierErr } = await admin.rpc('calculate_tier_from_xp', {
      _xp: xpToSet,
      _current_tier: currentTier,
    });
    const nextTier = !tierErr && tierData ? tierData : currentTier;

    const { error: updErr } = await admin
      .from('profiles')
      .update({ xp: xpToSet, tier: nextTier, updated_at: new Date().toISOString() })
      .eq('id', targetUserId);
    if (updErr) return res.status(400).json({ error: updErr.message });

    return res.status(200).json({
      success: true,
      user: {
        id: targetProfile.id,
        name: targetProfile.name,
        matricula: targetProfile.matricula,
        email: targetProfile.email,
        previous_xp: targetProfile.xp,
        new_xp: xpToSet,
        previous_tier: targetProfile.tier,
        new_tier: nextTier,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
