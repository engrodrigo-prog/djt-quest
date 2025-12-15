import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

    // XP ladder (10 degraus) inspirada no formato clássico de 10 níveis (sem citar nomes).
    const MILHAO_XP_TABLE = [100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000];

    let isMilhao = false;
    try {
      const { data: ch } = await supabase.from('challenges').select('title').eq('id', challengeId).maybeSingle();
      const title = String(ch?.title || '');
      isMilhao = /milh(ã|a)o/i.test(title);
    } catch {
      isMilhao = false;
    }

    // Ensure attempt exists and not already submitted
    await supabase
      .from('quiz_attempts')
      .upsert({ user_id: user.id, challenge_id: challengeId }, { onConflict: 'user_id,challenge_id' } as any);

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('submitted_at')
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

    const xpEarned = isCorrect
      ? (isMilhao ? (MILHAO_XP_TABLE[questionOrderIndex] ?? option.quiz_questions.xp_value) : option.quiz_questions.xp_value)
      : 0;
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
    if (xpEarned > 0) {
      try {
        await supabase.rpc('increment_user_xp', { _user_id: user.id, _xp_to_add: xpEarned });
      } catch (e) {
        // fallback: mantém comportamento anterior (pode não atualizar tier)
        if (profile) {
          await supabase
            .from('profiles')
            .update({ xp: (profile.xp || 0) + xpEarned })
            .eq('id', user.id);
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
    if (!isCorrect) {
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
        explanation: option.explanation,
        correctOptionId,
        isCompleted: Boolean(endedReason),
        endedReason: endedReason || undefined,
        totalXpEarned: endedReason ? totalXpEarned : undefined,
        xpBlockedForLeader
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in submit-quiz-answer:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
