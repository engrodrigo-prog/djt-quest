import { createSupabaseAdminClient, requireCallerUser } from '../lib/supabase-admin.js';
import { tryInsertAuditLog } from '../lib/audit-log.js';

const safeErrMsg = (e) => String(e?.message || e?.error_description || e?.details || e || '').trim() || 'Unknown error';

const asIso = () => new Date().toISOString();

const isMilhaoTitle = (title) => /milh(ã|a)o/i.test(String(title || ''));

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = createSupabaseAdminClient();
    const caller = await requireCallerUser(admin, req);

    const { challengeId } = req.body || {};
    const id = String(challengeId || '').trim();
    if (!id) return res.status(400).json({ error: 'challengeId required' });

    const { data: challenge, error: chErr } = await admin
      .from('challenges')
      .select('id, title, type, xp_reward, reward_mode, reward_tier_steps')
      .eq('id', id)
      .maybeSingle();
    if (chErr) return res.status(400).json({ error: chErr.message });
    if (!challenge) return res.status(404).json({ error: 'Quiz not found' });
    if (String(challenge.type || '') !== 'quiz') return res.status(400).json({ error: 'Not a quiz' });

    const isMilhao = isMilhaoTitle(challenge.title);

    const warnings = [];

    // Current XP (for safety clamp; avoid negative totals on inconsistent data)
    let currentXp = 0;
    let currentTier = null;
    try {
      const { data: prof } = await admin.from('profiles').select('xp, tier').eq('id', caller.id).maybeSingle();
      currentXp = Number(prof?.xp ?? 0) || 0;
      currentTier = prof?.tier ?? null;
    } catch {
      currentXp = 0;
      currentTier = null;
    }

    // Answers XP sum
    const { data: answers, error: ansErr } = await admin
      .from('user_quiz_answers')
      .select('xp_earned')
      .eq('user_id', caller.id)
      .eq('challenge_id', id);
    if (ansErr) return res.status(400).json({ error: ansErr.message });
    const xpSum = (answers || []).reduce((acc, r) => acc + (Number(r?.xp_earned) || 0), 0);

    // Attempt score (includes completion bonus when finalized)
    let attempt = null;
    try {
      const { data } = await admin
        .from('quiz_attempts')
        .select('submitted_at, score')
        .eq('user_id', caller.id)
        .eq('challenge_id', id)
        .maybeSingle();
      attempt = data || null;
    } catch {
      attempt = null;
    }

    // Determine whether the user likely completed the quiz (for bonus recovery in legacy edge cases)
    let totalQuestions = 0;
    let answeredQuestions = (answers || []).length;
    try {
      const [{ count: tq }, { count: aq }] = await Promise.all([
        admin.from('quiz_questions').select('id', { count: 'exact', head: true }).eq('challenge_id', id),
        admin
          .from('user_quiz_answers')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', caller.id)
          .eq('challenge_id', id),
      ]);
      totalQuestions = Number(tq ?? 0) || 0;
      answeredQuestions = Number(aq ?? answeredQuestions) || answeredQuestions;
    } catch {
      // ignore
    }

    const attemptScore = Number(attempt?.score ?? NaN);
    const attemptScoreOk = Number.isFinite(attemptScore) && attemptScore > 0;
    const likelyCompleted = totalQuestions > 0 && answeredQuestions >= totalQuestions;
    const rewardXp = Number(challenge?.xp_reward ?? 0) || 0;

    // XP that was applied by this quiz (best-effort)
    let xpToRevert = attemptScoreOk ? Math.floor(attemptScore) : Math.floor(xpSum);
    if (!attemptScoreOk && likelyCompleted && !isMilhao) {
      // Completion bonus is not stored on user_quiz_answers; approximate total as max(sum, reward).
      xpToRevert = Math.max(xpToRevert, Math.floor(rewardXp));
    }

    const safeRevert = Math.max(0, Math.min(Math.floor(currentXp), Math.floor(xpToRevert)));

    // Revert XP (best-effort)
    if (safeRevert > 0) {
      try {
        const { error: xpErr } = await admin.rpc('increment_user_xp', { _user_id: caller.id, _xp_to_add: -safeRevert });
        if (xpErr) throw xpErr;
      } catch (e) {
        // fallback: clamp + try update tier
        try {
          const nextXp = Math.max(0, Math.floor(currentXp) - safeRevert);
          let nextTier = currentTier;
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
            .update({ xp: nextXp, ...(nextTier ? { tier: nextTier } : {}), updated_at: asIso() })
            .eq('id', caller.id);
          if (upErr) throw upErr;
          warnings.push('XP revertido via fallback (profiles.update).');
        } catch (e2) {
          warnings.push(`Falha ao reverter XP: ${safeErrMsg(e)} / ${safeErrMsg(e2)}`);
        }
      }
    }

    // Delete answers
    const { error: delErr } = await admin
      .from('user_quiz_answers')
      .delete()
      .eq('user_id', caller.id)
      .eq('challenge_id', id);
    if (delErr) return res.status(400).json({ error: delErr.message, stage: 'delete_answers' });

    // Reset attempt (best-effort; optional columns may not exist)
    const attemptBase = {
      user_id: caller.id,
      challenge_id: id,
      started_at: asIso(),
      submitted_at: null,
      score: 0,
      max_score: 0,
      help_used: false,
      reward_total_xp_target: null,
    };
    try {
      const { error: upErr } = await admin.from('quiz_attempts').upsert(attemptBase, { onConflict: 'user_id,challenge_id' });
      if (upErr) throw upErr;
    } catch (e) {
      try {
        const { error: upErr2 } = await admin
          .from('quiz_attempts')
          .upsert(
            {
              user_id: caller.id,
              challenge_id: id,
              started_at: asIso(),
              submitted_at: null,
              score: 0,
              max_score: 0,
            },
            { onConflict: 'user_id,challenge_id' },
          );
        if (upErr2) throw upErr2;
      } catch (e2) {
        warnings.push(`Falha ao resetar quiz_attempts: ${safeErrMsg(e)} / ${safeErrMsg(e2)}`);
      }
    }

    await tryInsertAuditLog(admin, {
      actor_id: caller.id,
      action: 'quiz.reset_attempt',
      entity_type: 'quiz',
      entity_id: id,
      before_json: { xp_sum_answers: xpSum, attempt_score: attemptScoreOk ? attemptScore : null },
      after_json: { xp_reverted: safeRevert, reset_at: asIso() },
    });

    return res.status(200).json({
      success: true,
      challenge_id: id,
      xp_reverted: safeRevert,
      xp_estimated_total: xpToRevert,
      warnings,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

