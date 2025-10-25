import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvaluationRequest {
  eventId: string;
  approved: boolean;
  feedback: string;
  rating: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (!user) throw new Error('Unauthorized');

    const body: EvaluationRequest = await req.json();

    console.log('Processing evaluation:', { eventId: body.eventId, approved: body.approved });

    // Verificar que usuário é líder
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_leader')
      .eq('id', user.id)
      .single();

    if (!profile?.is_leader) {
      throw new Error('Apenas líderes podem avaliar ações');
    }

    // Validar feedback
    if (!body.feedback || body.feedback.length < 50) {
      throw new Error('Feedback deve ter no mínimo 50 caracteres');
    }

    // Validar rating
    if (body.rating < 1 || body.rating > 5) {
      throw new Error('Rating deve estar entre 1 e 5');
    }

    // Buscar dados do evento
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('user_id, challenge_id, retry_count, challenges(xp_reward)')
      .eq('id', body.eventId)
      .single();

    if (eventError) throw eventError;

    const challenge = eventData.challenges as any;
    const baseXp = challenge?.xp_reward || 0;

    // Calcular pontos finais com penalidade de retry
    const retryPenalty = body.eventId ? 
      (eventData.retry_count === 0 ? 1.0 : 
       eventData.retry_count === 1 ? 0.8 :
       eventData.retry_count === 2 ? 0.6 : 0.4) : 1.0;

    const qualityScore = body.approved ? (body.rating / 5.0) : 0;
    const finalPoints = Math.floor(baseXp * qualityScore * retryPenalty);

    // Atualizar evento
    const newStatus = body.approved ? 'approved' : 'rejected';
    
    const { error: updateError } = await supabase
      .from('events')
      .update({
        status: newStatus,
        quality_score: qualityScore,
        points_calculated: finalPoints,
        final_points: finalPoints
      })
      .eq('id', body.eventId);

    if (updateError) throw updateError;

    // Se aprovado, atualizar XP do usuário
    if (body.approved && finalPoints > 0) {
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('xp')
        .eq('id', eventData.user_id)
        .single();

      if (userProfile) {
        await supabase
          .from('profiles')
          .update({ xp: userProfile.xp + finalPoints })
          .eq('id', eventData.user_id);
      }
    }

    // Inserir avaliação simplificada
    const { data: evaluation, error: evalError } = await supabase
      .from('action_evaluations')
      .insert({
        event_id: body.eventId,
        reviewer_id: user.id,
        reviewer_level: 'leadership',
        rating: body.rating,
        feedback_positivo: body.approved ? body.feedback : null,
        feedback_construtivo: !body.approved ? body.feedback : null,
        scores: { overall: body.rating }
      })
      .select()
      .single();

    if (evalError) throw evalError;

    // Notificar usuário
    await supabase.rpc('create_notification', {
      _user_id: eventData.user_id,
      _type: 'evaluation_complete',
      _title: body.approved ? 'Ação Aprovada!' : 'Ação Reprovada',
      _message: body.approved 
        ? `Sua ação foi aprovada! +${finalPoints} XP. ${body.feedback}`
        : `Sua ação precisa ser refeita. ${body.feedback}`,
      _metadata: { 
        event_id: body.eventId,
        rating: body.rating,
        points: finalPoints,
        approved: body.approved
      }
    });

    console.log('Evaluation completed:', { 
      eventId: body.eventId, 
      approved: body.approved,
      points: finalPoints
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        evaluation,
        finalPoints,
        message: body.approved ? 'Ação aprovada!' : 'Ação reprovada'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in studio-evaluations:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
