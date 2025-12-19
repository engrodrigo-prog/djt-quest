import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MILHAO_XP_TABLE = [100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000];
const MILHAO_XP_TOTAL_BASE = MILHAO_XP_TABLE.reduce((sum, n) => sum + n, 0);
const DEFAULT_MILHAO_TOTAL_XP = 1000;
const MIN_MILHAO_TOTAL_XP = 100;
const MAX_MILHAO_TOTAL_XP = 5000;

type TierPrefix = 'EX' | 'FO' | 'GU';
const TIER_THRESHOLDS: Record<TierPrefix, number[]> = {
  EX: [0, 300, 700, 1200, 1800],
  FO: [0, 400, 900, 1500, 2200],
  GU: [0, 500, 1100, 1800, 2600],
};

const safeErrMsg = (err: unknown) => {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const msg = (err as any)?.message;
  if (typeof msg === 'string') return msg;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

const parseTier = (tierRaw: unknown): { prefix: TierPrefix; level: number } | null => {
  const tier = (tierRaw ?? '').toString().trim().toUpperCase();
  const match = tier.match(/^(EX|FO|GU)\s*-\s*([1-5])$/);
  if (!match) return null;
  const prefix = match[1] as TierPrefix;
  const level = Number(match[2]);
  if (!Number.isFinite(level) || level < 1 || level > 5) return null;
  return { prefix, level };
};

const clampInt = (n: number, min: number, max: number) => {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const computeTierFromXpLocal = (params: { currentTier: unknown; xp: number }) => {
  const parsed = parseTier(params.currentTier);
  if (!parsed) return null;
  const { prefix } = parsed;
  const thresholds = TIER_THRESHOLDS[prefix];
  const xp = Number(params.xp) || 0;
  if (xp >= (thresholds[4] ?? Infinity)) return `${prefix}-5`;
  if (xp >= (thresholds[3] ?? Infinity)) return `${prefix}-4`;
  if (xp >= (thresholds[2] ?? Infinity)) return `${prefix}-3`;
  if (xp >= (thresholds[1] ?? Infinity)) return `${prefix}-2`;
  return `${prefix}-1`;
};

const xpNeededToAdvanceTierSteps = (params: { currentXp: number; currentTier: unknown; steps: number }) => {
  const { currentXp, currentTier, steps } = params;
  const parsed = parseTier(currentTier);
  if (!parsed) return 0;

  const { prefix, level } = parsed;
  const thresholds = TIER_THRESHOLDS[prefix];
  const targetLevel = clampInt(level + steps, 1, 5);
  const targetThreshold = thresholds[targetLevel - 1] ?? thresholds[thresholds.length - 1] ?? 0;
  const needed = Math.max(0, targetThreshold - (Number(currentXp) || 0));
  return Math.floor(needed);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const loadRoles = async (supabase: any, userId: string) => {
    const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId);
    if (error) return new Set<string>();
    const set = new Set<string>();
    for (const row of data || []) {
      const r = String((row as any)?.role || '').trim();
      if (r) set.add(r);
    }
    return set;
  };

  const loadChallengeMeta = async (supabase: any, challengeId: string) => {
    const selectV2 = 'title, xp_reward, reward_mode, reward_tier_steps, owner_id, created_by, status';
    const selectV1 = 'title, xp_reward, reward_mode, reward_tier_steps, owner_id, created_by';

    let data: any = null;
    const v2 = await supabase.from('challenges').select(selectV2).eq('id', challengeId).maybeSingle();
    data = v2.data as any;
    // Backward-compat: older envs may not have status
    if (v2.error && /status/i.test(String(v2.error?.message || v2.error))) {
      const v1 = await supabase.from('challenges').select(selectV1).eq('id', challengeId).maybeSingle();
      data = v1.data as any;
    }
    const title = String((data as any)?.title || '');
    const xpRewardRaw = (data as any)?.xp_reward;
    const xpReward =
      typeof xpRewardRaw === 'number' ? Number(xpRewardRaw) : Number(xpRewardRaw ?? NaN);
    const ownerId = (data as any)?.owner_id ? String((data as any).owner_id) : null;
    const createdBy = (data as any)?.created_by ? String((data as any).created_by) : null;
    const rewardModeRaw = String((data as any)?.reward_mode || '').trim();
    const rewardTierStepsRaw = (data as any)?.reward_tier_steps;
    const rewardTierSteps =
      typeof rewardTierStepsRaw === 'number' ? Number(rewardTierStepsRaw) : null;
    const status = (data as any)?.status != null ? String((data as any).status) : null;
    return {
      title,
      xpReward: Number.isFinite(xpReward) ? xpReward : 0,
      rewardMode: rewardModeRaw,
      rewardTierSteps,
      ownerId,
      createdBy,
      status,
    };
  };

  const getQuizCounts = async (supabase: any, userId: string, challengeId: string) => {
    const [{ count: totalQuestions }, { count: answeredQuestions }] = await Promise.all([
      supabase
        .from('quiz_questions')
        .select('id', { count: 'exact', head: true })
        .eq('challenge_id', challengeId),
      supabase
        .from('user_quiz_answers')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('challenge_id', challengeId),
    ]);
    return {
      totalQuestions: Number(totalQuestions ?? 0),
      answeredQuestions: Number(answeredQuestions ?? 0),
      isCompleted: Number(totalQuestions ?? 0) === Number(answeredQuestions ?? 0),
    };
  };

  const getTotalXpSoFar = async (supabase: any, userId: string, challengeId: string) => {
    const { data: allAnswersForTotal } = await supabase
      .from('user_quiz_answers')
      .select('xp_earned')
      .eq('user_id', userId)
      .eq('challenge_id', challengeId);
    const totalXpSoFar =
      allAnswersForTotal?.reduce((sum: number, a: any) => sum + (Number(a?.xp_earned) || 0), 0) || 0;
    return Math.floor(totalXpSoFar);
  };

  const computeCompletionBonus = (params: { isMilhao: boolean; challengeXpReward: number; totalXpSoFar: number }) => {
    if (params.isMilhao) return 0;
    const target = Number(params.challengeXpReward) || 0;
    if (target <= 0) return 0;
    const delta = target - (Number(params.totalXpSoFar) || 0);
    if (!Number.isFinite(delta)) return 0;
    return Math.max(0, Math.floor(delta));
  };

  const awardQuizBestDelta = async (
    supabase: any,
    params: { userId: string; challengeId: string; newTotal: number },
  ): Promise<{ xpAwarded: number; bestScore: number }> => {
    const userId = String(params.userId || '').trim();
    const challengeId = String(params.challengeId || '').trim();
    const newTotal = clampInt(Number(params.newTotal || 0), 0, 1_000_000_000);
    if (!userId || !challengeId) return { xpAwarded: 0, bestScore: Math.max(0, newTotal) };

    const { data, error } = await supabase.rpc('award_quiz_best_delta', {
      _user_id: userId,
      _challenge_id: challengeId,
      _new_total: newTotal,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? (data[0] as any) : (data as any);
    const xpAwarded = Math.max(0, Math.floor(Number(row?.xp_awarded ?? 0) || 0));
    const bestScore = Math.max(0, Math.floor(Number(row?.best_score ?? 0) || 0));
    return { xpAwarded, bestScore };
  };

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { question_id, option_id } = await req.json();

    if (!question_id || !option_id) {
      throw new Error('Missing question_id or option_id');
    }

    console.log('Processing quiz answer', { user_id: user.id, question_id, option_id });

    // Check if user already answered this question
    const { data: existingAnswer } = await supabase
      .from('user_quiz_answers')
      .select('id, challenge_id, question_id, selected_option_id, is_correct, xp_earned')
      .eq('user_id', user.id)
      .eq('question_id', question_id)
      .maybeSingle();

    if (existingAnswer) {
      const challengeId = String((existingAnswer as any)?.challenge_id || '').trim();
      if (!challengeId) {
        return new Response(
          JSON.stringify({ error: 'Resposta já registrada' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const meta = await loadChallengeMeta(supabase, challengeId);
      const isMilhao = /milh(ã|a)o/i.test(String(meta.title || ''));
      const roleSet = await loadRoles(supabase, user.id);
      const isAdmin = roleSet.has('admin');
      const isContentCurator = roleSet.has('content_curator');
      const isOwner =
        (meta.ownerId && meta.ownerId === user.id) || (meta.createdBy && meta.createdBy === user.id);
      const canSeeAnswerKey = isAdmin || isContentCurator || isOwner;

      const { isCompleted, totalQuestions } = await getQuizCounts(supabase, user.id, challengeId);
      const totalXpSoFar = await getTotalXpSoFar(supabase, user.id, challengeId);

      // If quiz is complete but attempt wasn't finalized (e.g., previous request failed mid-way),
      // finalize now and award completion bonus (best-effort, idempotent via quiz_attempts.submitted_at).
      let completionBonusEarned = 0;
      let bestScoreBefore = 0;
      let bestScoreAfter = 0;
      let bestDeltaAwarded = 0;
      try {
        const { data: attempt } = await supabase
          .from('quiz_attempts')
          .select('submitted_at, reward_total_xp_target, score')
          .eq('user_id', user.id)
          .eq('challenge_id', challengeId)
          .maybeSingle();

        bestScoreBefore = Math.max(0, Math.floor(Number((attempt as any)?.score ?? 0) || 0));
        bestScoreAfter = bestScoreBefore;
        if (isMilhao) {
          const bestResp = await awardQuizBestDelta(supabase, {
            userId: user.id,
            challengeId,
            newTotal: totalXpSoFar,
          });
          bestDeltaAwarded = Math.max(0, Math.floor(Number(bestResp.xpAwarded ?? 0) || 0));
          bestScoreAfter = Math.max(bestScoreBefore, Math.floor(Number(bestResp.bestScore ?? 0) || 0));
        }

        if (isCompleted && !attempt?.submitted_at) {
          completionBonusEarned = computeCompletionBonus({
            isMilhao,
            challengeXpReward: meta.xpReward,
            totalXpSoFar,
          });
          if (completionBonusEarned > 0) {
            await supabase.rpc('increment_user_xp', { _user_id: user.id, _xp_to_add: completionBonusEarned });
          }
          await supabase
            .from('quiz_attempts')
            .upsert(
              {
                user_id: user.id,
                challenge_id: challengeId,
                submitted_at: new Date().toISOString(),
                ...(!isMilhao ? { score: totalXpSoFar + completionBonusEarned } : {}),
                max_score: totalQuestions ?? 0,
              },
              { onConflict: 'user_id,challenge_id' } as any
            );
        }
      } catch {
        // ignore
      }

      // Get correct option ID if user was wrong (restricted)
      let correctOptionId = null;
      if (!(existingAnswer as any)?.is_correct && canSeeAnswerKey) {
        try {
          const { data: correctOption } = await supabase
            .from('quiz_options')
            .select('id')
            .eq('question_id', question_id)
            .eq('is_correct', true)
            .single();
          correctOptionId = (correctOption as any)?.id || null;
        } catch {
          correctOptionId = null;
        }
      }

      const { data: profileAfter } = await supabase
        .from('profiles')
        .select('xp')
        .eq('id', user.id)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          success: true,
          alreadyAnswered: true,
          isCorrect: Boolean((existingAnswer as any)?.is_correct),
          xpEarned: isMilhao ? bestDeltaAwarded : (Number((existingAnswer as any)?.xp_earned) || 0) + completionBonusEarned,
          explanation: canSeeAnswerKey ? null : null,
          correctOptionId: canSeeAnswerKey ? correctOptionId : null,
          answerKeyRestricted: !canSeeAnswerKey,
          isCompleted: Boolean(isCompleted),
          endedReason: isCompleted ? 'completed' : undefined,
          totalXpEarned: isCompleted ? totalXpSoFar + completionBonusEarned : undefined,
          completionBonusEarned: completionBonusEarned || 0,
          bestScoreBefore: isMilhao ? bestScoreBefore : undefined,
          bestScoreAfter: isMilhao ? bestScoreAfter : undefined,
          profileXpAfter: typeof (profileAfter as any)?.xp === 'number' ? (profileAfter as any).xp : null,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the selected option
    const { data: option, error: optionError } = await supabase
      .from('quiz_options')
      .select('*, quiz_questions!inner(challenge_id, xp_value, order_index)')
      .eq('id', option_id)
      .single();

    if (optionError || !option) {
      throw new Error('Invalid option');
    }

    const isCorrect = option.is_correct;
    const challengeId = option.quiz_questions.challenge_id;
    const questionOrderIndex = Number(option.quiz_questions.order_index ?? 0);

    let isMilhao = false;
    let milhaoRewardMode: 'fixed_xp' | 'tier_steps' = 'fixed_xp';
    let milhaoTierSteps: number | null = null;
    let milhaoConfiguredTotalXp: number | null = null;
    let challengeOwnerId: string | null = null;
    let challengeCreatedBy: string | null = null;
    try {
      const selectV2 = 'title, xp_reward, reward_mode, reward_tier_steps, owner_id, created_by, status';
      const selectV1 = 'title, xp_reward, reward_mode, reward_tier_steps, owner_id, created_by';

      let ch: any = null;
      const v2 = await supabase.from('challenges').select(selectV2).eq('id', challengeId).maybeSingle();
      ch = v2.data as any;
      // Backward-compat: status column may not exist
      if (v2.error && /status/i.test(String(v2.error?.message || v2.error))) {
        const v1 = await supabase.from('challenges').select(selectV1).eq('id', challengeId).maybeSingle();
        ch = v1.data as any;
      }
      const title = String(ch?.title || '');
      isMilhao = /milh(ã|a)o/i.test(title);

      challengeOwnerId = (ch as any)?.owner_id ? String((ch as any).owner_id) : null;
      challengeCreatedBy = (ch as any)?.created_by ? String((ch as any).created_by) : null;
      const status = ((ch as any)?.status != null ? String((ch as any).status) : 'active').toLowerCase();
      if (status === 'closed' || status === 'canceled' || status === 'cancelled') {
        return new Response(
          JSON.stringify({ error: 'Quiz encerrado para novas respostas' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const modeRaw = String((ch as any)?.reward_mode || '').trim();
      milhaoRewardMode = modeRaw === 'tier_steps' ? 'tier_steps' : 'fixed_xp';
      milhaoTierSteps = typeof (ch as any)?.reward_tier_steps === 'number' ? Number((ch as any).reward_tier_steps) : null;
      milhaoConfiguredTotalXp =
        typeof (ch as any)?.xp_reward === 'number' ? Number((ch as any).xp_reward) : Number((ch as any)?.xp_reward ?? NaN);
    } catch {
      isMilhao = false;
    }

    const roleSet = await loadRoles(supabase, user.id);
    const isAdmin = roleSet.has('admin');
    const isContentCurator = roleSet.has('content_curator');
    const isOwner = Boolean(challengeOwnerId && challengeOwnerId === user.id) || Boolean(challengeCreatedBy && challengeCreatedBy === user.id);
    const canSeeAnswerKey = isAdmin || isContentCurator || isOwner;
    const completionTargetXp = !isMilhao ? Math.max(0, Math.floor(Number(milhaoConfiguredTotalXp || 0))) : 0;

    // Ensure attempt exists and not already submitted
    await supabase
      .from('quiz_attempts')
      .upsert({ user_id: user.id, challenge_id: challengeId }, { onConflict: 'user_id,challenge_id' } as any);

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('submitted_at, reward_total_xp_target, score')
      .eq('user_id', user.id)
      .eq('challenge_id', challengeId)
      .maybeSingle();
    if (attempt?.submitted_at) {
      return new Response(
        JSON.stringify({ error: 'Tentativa já finalizada para este quiz' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('xp, tier, is_leader')
      .eq('id', user.id)
      .maybeSingle();

    let xpEarned = 0;
    if (isCorrect) {
      if (isMilhao) {
        let targetTotalXp: number | null = null;
        if (milhaoRewardMode === 'tier_steps') {
          const steps = clampInt(Number(milhaoTierSteps ?? 1), 1, 5);
          if (attempt?.reward_total_xp_target != null) {
            targetTotalXp = Math.max(0, Number(attempt.reward_total_xp_target) || 0);
          } else {
            const computed = xpNeededToAdvanceTierSteps({
              currentXp: Number(profile?.xp) || 0,
              currentTier: profile?.tier,
              steps,
            });
            targetTotalXp = computed;
            await supabase
              .from('quiz_attempts')
              .update({ reward_total_xp_target: computed })
              .eq('user_id', user.id)
              .eq('challenge_id', challengeId);
          }
        } else {
          const configured = Number(milhaoConfiguredTotalXp || 0);
          targetTotalXp = configured > 0 ? configured : DEFAULT_MILHAO_TOTAL_XP;
        }

        const clampedTarget = clampInt(Number(targetTotalXp || 0), 0, MAX_MILHAO_TOTAL_XP);
        const safeTarget = clampedTarget > 0 ? Math.max(MIN_MILHAO_TOTAL_XP, clampedTarget) : 0;
        const scale = safeTarget > 0 ? safeTarget / MILHAO_XP_TOTAL_BASE : 0;
        const base = MILHAO_XP_TABLE[questionOrderIndex] ?? option.quiz_questions.xp_value;
        const scaled = Math.round(Number(base) * scale);
        xpEarned = safeTarget > 0 ? Math.max(1, scaled) : 0;
      } else {
        xpEarned = option.quiz_questions.xp_value;
      }
    }
    // Regra de jogo: líderes normalmente não competem, mas para testes isso pode ser habilitado/alterado no futuro.
    const xpBlockedForLeader = false;

    // Insert user answer
    const { error: insertError } = await supabase
      .from('user_quiz_answers')
      .insert({
        user_id: user.id,
        challenge_id: challengeId,
        question_id: question_id,
        selected_option_id: option_id,
        is_correct: isCorrect,
        xp_earned: xpEarned
      });

    if (insertError) {
      console.error('Error inserting answer:', insertError);
      throw insertError;
    }

    const bestScoreBefore = Math.max(0, Math.floor(Number((attempt as any)?.score ?? 0) || 0));
    let bestScoreAfter = bestScoreBefore;

    // Totals for this attempt (after inserting the answer)
    const { count: totalQuestions } = await supabase
      .from('quiz_questions')
      .select('id', { count: 'exact', head: true })
      .eq('challenge_id', challengeId);

    const { data: allAnswersForTotal } = await supabase
      .from('user_quiz_answers')
      .select('xp_earned')
      .eq('user_id', user.id)
      .eq('challenge_id', challengeId);
    const answeredQuestions = Array.isArray(allAnswersForTotal) ? allAnswersForTotal.length : 0;
    const totalXpSoFar =
      allAnswersForTotal?.reduce((sum: number, a: any) => sum + (Number(a?.xp_earned) || 0), 0) || 0;
    const isCompleted = Number(totalQuestions ?? 0) === answeredQuestions;

    // Apply XP: Milhão = best-of record; other quizzes = per-answer
    let xpApplied = false;
    let profileXpAfter: number | null = null;
    let xpAwardedNow = 0;

    if (!xpBlockedForLeader) {
      if (isMilhao) {
        const expectedDelta = Math.max(0, Math.floor(totalXpSoFar) - bestScoreBefore);
        try {
          const bestResp = await awardQuizBestDelta(supabase, {
            userId: user.id,
            challengeId,
            newTotal: totalXpSoFar,
          });
          xpAwardedNow = Math.max(0, Math.floor(Number(bestResp.xpAwarded ?? 0) || 0));
          bestScoreAfter = Math.max(bestScoreAfter, Math.floor(Number(bestResp.bestScore ?? 0) || 0));
          xpApplied = true;
        } catch (e) {
          console.error('award_quiz_best_delta failed:', safeErrMsg(e));
          xpAwardedNow = expectedDelta;
          xpApplied = false;
          bestScoreAfter = bestScoreBefore;
        }
      } else if (xpEarned > 0) {
        xpAwardedNow = xpEarned;
        const { error: incErr } = await supabase.rpc('increment_user_xp', { _user_id: user.id, _xp_to_add: xpEarned });
        if (incErr) {
          console.error('increment_user_xp failed:', incErr.message || incErr);
          // fallback: mantém comportamento anterior (pode não atualizar tier)
          let baseXp = Number(profile?.xp);
          let baseTier = (profile as any)?.tier;
          if (!Number.isFinite(baseXp)) {
            const { data: p2 } = await supabase.from('profiles').select('xp, tier').eq('id', user.id).maybeSingle();
            baseXp = Number((p2 as any)?.xp);
            baseTier = (p2 as any)?.tier;
          }
          if (!Number.isFinite(baseXp)) baseXp = 0;

          const targetXp = baseXp + xpEarned;
          const nextTier = computeTierFromXpLocal({ currentTier: baseTier, xp: targetXp });
          const { error: updErr } = await supabase
            .from('profiles')
            .update({ xp: targetXp, ...(nextTier ? { tier: nextTier } : {}) })
            .eq('id', user.id);
          if (updErr) {
            console.error('profiles xp update fallback failed:', updErr.message || updErr);
          } else {
            xpApplied = true;
          }
        } else {
          xpApplied = true;
        }
      }

      if (xpApplied && xpAwardedNow > 0) {
        const { data: fresh, error: freshErr } = await supabase
          .from('profiles')
          .select('xp')
          .eq('id', user.id)
          .maybeSingle();
        if (freshErr) {
          console.warn('Could not fetch profile xp after awarding:', freshErr.message || freshErr);
        } else if (fresh && typeof (fresh as any).xp === 'number') {
          profileXpAfter = (fresh as any).xp;
        }
      }
    }

    // Get correct option ID if user was wrong
    let correctOptionId = null;
    if (!isCorrect && canSeeAnswerKey) {
      const { data: correctOption } = await supabase
        .from('quiz_options')
        .select('id')
        .eq('question_id', question_id)
        .eq('is_correct', true)
        .single();
      
      correctOptionId = correctOption?.id;
    }

    // Calculate total XP earned in this quiz
    let totalXpEarned = 0;
    let endedReason: 'completed' | 'wrong' | null = null;
    let completionBonusEarned = 0;

    if (isCompleted) {
      if (isMilhao && !xpBlockedForLeader) {
        try {
          const bestResp = await awardQuizBestDelta(supabase, {
            userId: user.id,
            challengeId,
            newTotal: totalXpSoFar,
          });
          const awarded = Math.max(0, Math.floor(Number(bestResp.xpAwarded ?? 0) || 0));
          const best = Math.max(0, Math.floor(Number(bestResp.bestScore ?? 0) || 0));
          bestScoreAfter = Math.max(bestScoreAfter, best);
          if (awarded > 0) {
            xpAwardedNow = awarded;
            xpApplied = true;
            if (profileXpAfter == null) {
              const { data: fresh } = await supabase.from('profiles').select('xp').eq('id', user.id).maybeSingle();
              if (fresh && typeof (fresh as any).xp === 'number') profileXpAfter = (fresh as any).xp;
            }
          }
        } catch {
          // ignore
        }
      }

      // Ensure total XP for the quiz reaches challenges.xp_reward when configured (non-milhao).
      completionBonusEarned = computeCompletionBonus({
        isMilhao,
        challengeXpReward: completionTargetXp,
        totalXpSoFar,
      });
      if (completionBonusEarned > 0 && !xpBlockedForLeader) {
        try {
          const { error: incBonusErr } = await supabase.rpc('increment_user_xp', {
            _user_id: user.id,
            _xp_to_add: completionBonusEarned,
          });
          if (incBonusErr) console.error('increment_user_xp bonus failed:', incBonusErr.message || incBonusErr);
        } catch {
          // ignore
        }
      }

      totalXpEarned = totalXpSoFar + completionBonusEarned;
      endedReason = 'completed';

      // finalize attempt (best-effort)
      await supabase
        .from('quiz_attempts')
        .upsert(
          {
            user_id: user.id,
            challenge_id: challengeId,
            submitted_at: new Date().toISOString(),
            score: isMilhao ? bestScoreAfter : totalXpEarned,
            max_score: totalQuestions ?? 0,
          },
          { onConflict: 'user_id,challenge_id' } as any
        );

      // Create completion notification
      await supabase.rpc('create_notification', {
        _user_id: user.id,
        _type: 'quiz_completed',
        _title: '✅ Quiz Concluído!',
        _message: `Você completou o quiz e ganhou ${totalXpEarned} XP total!`,
        _metadata: {
          challenge_id: challengeId,
          total_xp: totalXpEarned
        }
      });
    } else if (isMilhao && !isCorrect) {
      // Regra do "Quiz do Milhão": errou, encerra o jogo e soma pontos até onde chegou.
      totalXpEarned = totalXpSoFar;
      endedReason = 'wrong';

      await supabase
        .from('quiz_attempts')
        .upsert(
          {
            user_id: user.id,
            challenge_id: challengeId,
            submitted_at: new Date().toISOString(),
            score: bestScoreAfter,
            max_score: totalQuestions ?? 0,
          },
          { onConflict: 'user_id,challenge_id' } as any
        );

      await supabase.rpc('create_notification', {
        _user_id: user.id,
        _type: 'quiz_finished',
        _title: '🏁 Quiz finalizado',
        _message: `Você encerrou o Quiz do Milhão no nível ${questionOrderIndex + 1}. Total acumulado: ${totalXpEarned} XP.`,
        _metadata: {
          challenge_id: challengeId,
          ended_reason: 'wrong',
          reached_level: questionOrderIndex + 1,
          total_xp: totalXpEarned
        }
      });
    }

    console.log('Answer processed successfully', { isCorrect, xpEarned, isCompleted });

    return new Response(
      JSON.stringify({
        success: true,
        isCorrect,
        xpEarned: xpAwardedNow + (endedReason === 'completed' ? completionBonusEarned : 0),
        explanation: canSeeAnswerKey ? option.explanation : null,
        correctOptionId: canSeeAnswerKey ? correctOptionId : null,
        answerKeyRestricted: !canSeeAnswerKey,
        isCompleted: Boolean(endedReason),
        endedReason: endedReason || undefined,
        totalXpEarned: endedReason ? totalXpEarned : undefined,
        completionBonusEarned: endedReason === 'completed' ? completionBonusEarned : 0,
        bestScoreBefore: isMilhao ? bestScoreBefore : undefined,
        bestScoreAfter: isMilhao ? bestScoreAfter : undefined,
        xpBlockedForLeader,
        xpApplied,
        profileXpAfter,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in submit-quiz-answer:', error);
    const message = safeErrMsg(error) || 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
