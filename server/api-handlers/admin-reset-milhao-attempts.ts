// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

// Whitelist hard: somente estes usuários podem resetar tentativas/pontuação (manutenção)
const ALLOWED_EMAILS = new Set([
  'rodrigonasc@cpfl.com.br',
  'cveiga@cpfl.com.br',
  'rodrigoalmeida@cpfl.com.br',
  'paulo.camara@cpfl.com.br',
]);
const ALLOWED_MATRICULAS = new Set(['601555', '3005597', '866776', '2011902']);

const asIso = () => new Date().toISOString();

const safeErrMsg = (e: any) => String(e?.message || e?.error_description || e?.details || e || '').trim() || 'Unknown error';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers['authorization'] as string | undefined;
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
    if (!allowed) return res.status(403).json({ error: 'Sem permissão para reabrir tentativas.' });

    const body = (req.body || {}) as any;
    const requestedChallengeIds: string[] = Array.isArray(body.challenge_ids)
      ? body.challenge_ids.map((x: any) => String(x).trim()).filter(Boolean)
      : [];

    let targetUserId = (body.user_id ? String(body.user_id) : '').trim() || null;
    if (!targetUserId && body.matricula) {
      const m = String(body.matricula).trim();
      const { data: target } = await admin.from('profiles').select('id').eq('matricula', m).maybeSingle();
      targetUserId = target?.id || null;
    }
    if (!targetUserId) {
      // default: o próprio ator (útil para o admin testar sem buscar usuário)
      targetUserId = actorId;
    }

    let challengeIds = requestedChallengeIds;
    if (!challengeIds.length) {
      const { data: latest } = await admin
        .from('challenges')
        .select('id,title,created_at')
        .ilike('title', 'Quiz do Milhão:%')
        .order('created_at', { ascending: false })
        .limit(2);
      challengeIds = (latest || []).map((c: any) => c.id);
    }
    if (!challengeIds.length) return res.status(404).json({ error: 'Nenhum Quiz do Milhão encontrado para reabrir.' });

    const results: any[] = [];
    const warnings: string[] = [];
    for (const challengeId of challengeIds) {
      // somar XP ganho nesse quiz (máximo ~10 linhas)
      const { data: answers } = await admin
        .from('user_quiz_answers')
        .select('xp_earned')
        .eq('user_id', targetUserId)
        .eq('challenge_id', challengeId);
      const xpSum = (answers || []).reduce((acc: number, r: any) => acc + (Number(r?.xp_earned) || 0), 0);

      // reverter XP antes de apagar as evidências (best-effort)
      if (xpSum && !Boolean((req.body || {})?.skip_xp_revert)) {
        try {
          const { error: xpErr } = await admin.rpc('increment_user_xp', { _user_id: targetUserId, _xp_to_add: -xpSum });
          if (xpErr) throw xpErr;
        } catch (e) {
          // fallback: ajuste direto (sem quebrar reabertura)
          try {
            const { data: prof, error: profErr } = await admin
              .from('profiles')
              .select('xp,tier')
              .eq('id', targetUserId)
              .maybeSingle();
            if (profErr) throw profErr;
            const curXp = Number(prof?.xp ?? 0);
            const nextXp = Math.max(0, curXp - xpSum);
            let nextTier = prof?.tier ?? null;
            try {
              const { data: tierData, error: tierErr } = await admin.rpc('calculate_tier_from_xp', {
                _xp: nextXp,
                _current_tier: nextTier,
              });
              if (!tierErr && tierData) nextTier = tierData;
            } catch {
              // ignore
            }
            const { error: upErr } = await admin
              .from('profiles')
              .update({ xp: nextXp, ...(nextTier ? { tier: nextTier } : {}), updated_at: asIso() } as any)
              .eq('id', targetUserId);
            if (upErr) throw upErr;
            warnings.push(`XP revertido via fallback no quiz ${challengeId}.`);
          } catch (e2) {
            warnings.push(`Falha ao reverter XP no quiz ${challengeId}: ${safeErrMsg(e)} / ${safeErrMsg(e2)}.`);
          }
        }
      }

      const { error: delErr } = await admin
        .from('user_quiz_answers')
        .delete()
        .eq('user_id', targetUserId)
        .eq('challenge_id', challengeId);
      if (delErr) return res.status(400).json({ error: delErr.message, stage: 'delete_answers', challenge_id: challengeId });

      // reset attempt (inclui colunas opcionais se existirem)
      const attemptBase: any = {
        user_id: targetUserId,
        challenge_id: challengeId,
        started_at: asIso(),
        submitted_at: null,
        score: 0,
        max_score: 0,
        help_used: false,
        reward_total_xp_target: null,
      };
      const { error: upErr } = await admin
        .from('quiz_attempts')
        .upsert(attemptBase, { onConflict: 'user_id,challenge_id' } as any);
      if (upErr) {
        // fallback: coluna opcional pode não existir em alguns ambientes
        const { error: upErr2 } = await admin
          .from('quiz_attempts')
          .upsert(
            {
              user_id: targetUserId,
              challenge_id: challengeId,
              started_at: asIso(),
              submitted_at: null,
              score: 0,
              max_score: 0,
            } as any,
            { onConflict: 'user_id,challenge_id' } as any,
          );
        if (upErr2) return res.status(400).json({ error: upErr2.message, stage: 'reset_attempt', challenge_id: challengeId });
      }

      results.push({ challenge_id: challengeId, xp_reverted: xpSum });
    }

    return res.status(200).json({ success: true, user_id: targetUserId, reopened: results, warnings });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
