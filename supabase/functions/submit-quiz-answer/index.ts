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
      .select('*, quiz_questions!inner(challenge_id, xp_value)')
      .eq('id', option_id)
      .single();

    if (optionError || !option) {
      throw new Error('Invalid option');
    }

    const isCorrect = option.is_correct;
    const challengeId = option.quiz_questions.challenge_id;

    const { data: profile } = await supabase
      .from('profiles')
      .select('xp, is_leader')
      .eq('id', user.id)
      .maybeSingle();

    const isLeader = profile?.is_leader === true;
    const xpEarned = isCorrect && !isLeader ? option.quiz_questions.xp_value : 0;
    const xpBlockedForLeader = isCorrect && isLeader;

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

    // Update user XP if correct
    if (xpEarned > 0 && profile) {
      await supabase
        .from('profiles')
        .update({ xp: profile.xp + xpEarned })
        .eq('id', user.id);
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
    if (isCompleted) {
      const { data: allAnswers } = await supabase
        .from('user_quiz_answers')
        .select('xp_earned')
        .eq('user_id', user.id)
        .eq('challenge_id', challengeId);

      totalXpEarned = allAnswers?.reduce((sum, a) => sum + a.xp_earned, 0) || 0;

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
    }

    console.log('Answer processed successfully', { isCorrect, xpEarned, isCompleted });

    return new Response(
      JSON.stringify({
        success: true,
        isCorrect,
        xpEarned,
        explanation: option.explanation,
        correctOptionId,
        isCompleted,
        totalXpEarned: isCompleted ? totalXpEarned : undefined,
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
