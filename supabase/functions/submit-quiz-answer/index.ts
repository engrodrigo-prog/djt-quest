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
      .select('id')
      .eq('user_id', user.id)
      .eq('question_id', question_id)
      .maybeSingle();

    if (existingAnswer) {
      return new Response(
        JSON.stringify({ error: 'Você já respondeu esta pergunta' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      const { data: ch } = await supabase
        .from('challenges')
        .select('title, xp_reward, reward_mode, reward_tier_steps, owner_id, created_by')
        .eq('id', challengeId)
        .maybeSingle();
      const title = String(ch?.title || '');
      isMilhao = /milh(ã|a)o/i.test(title);

      challengeOwnerId = (ch as any)?.owner_id ? String((ch as any).owner_id) : null;
      challengeCreatedBy = (ch as any)?.created_by ? String((ch as any).created_by) : null;

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

    // Ensure attempt exists and not already submitted
    await supabase
      .from('quiz_attempts')
      .upsert({ user_id: user.id, challenge_id: challengeId }, { onConflict: 'user_id,challenge_id' } as any);

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('submitted_at, reward_total_xp_target')
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

    // Update XP + tier if correct (usa RPC para manter tier sincronizado)
    let xpApplied = false;
    let profileXpAfter: number | null = null;
    if (xpEarned > 0 && !xpBlockedForLeader) {
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

      if (xpApplied) {
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

    // Check if quiz is completed
    const { count: totalQuestions } = await supabase
      .from('quiz_questions')
      .select('id', { count: 'exact', head: true })
      .eq('challenge_id', challengeId);

    const { count: answeredQuestions } = await supabase
      .from('user_quiz_answers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('challenge_id', challengeId);

    const isCompleted = totalQuestions === answeredQuestions;

    // Total XP earned so far in this quiz
    const { data: allAnswersForTotal } = await supabase
      .from('user_quiz_answers')
      .select('xp_earned')
      .eq('user_id', user.id)
      .eq('challenge_id', challengeId);
    const totalXpSoFar = allAnswersForTotal?.reduce((sum, a) => sum + (a.xp_earned || 0), 0) || 0;

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

    if (isCompleted) {
      totalXpEarned = totalXpSoFar;
      endedReason = 'completed';

      // finalize attempt (best-effort)
      await supabase
        .from('quiz_attempts')
        .upsert(
          { user_id: user.id, challenge_id: challengeId, submitted_at: new Date().toISOString(), score: totalXpEarned, max_score: totalQuestions ?? 0 },
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
          { user_id: user.id, challenge_id: challengeId, submitted_at: new Date().toISOString(), score: totalXpEarned, max_score: totalQuestions ?? 0 },
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
        xpEarned,
        explanation: canSeeAnswerKey ? option.explanation : null,
        correctOptionId: canSeeAnswerKey ? correctOptionId : null,
        answerKeyRestricted: !canSeeAnswerKey,
        isCompleted: Boolean(endedReason),
        endedReason: endedReason || undefined,
        totalXpEarned: endedReason ? totalXpEarned : undefined,
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
