import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvaluationRequest {
  eventId: string;
  scores: Record<string, number>;
  feedbackPositivo: string;
  feedbackConstrutivo: string;
  attachments?: string[];
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

    // Validate permission using database function
    const { data: canEval, error: permError } = await supabase.rpc('can_evaluate_event', {
      _user_id: user.id,
      _event_id: body.eventId
    });

    if (permError || !canEval) {
      throw new Error('Você não tem permissão para avaliar este evento');
    }

    // Get user role
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const role = roleData?.role;
    let reviewerLevel: string;

    if (role === 'coordenador_djtx') reviewerLevel = 'coordenacao';
    else if (role === 'lider_divisao_djtx') reviewerLevel = 'divisao';
    else if (role === 'gerente_djt') reviewerLevel = 'departamento';
    else throw new Error('Role inválido para avaliação');

    // Validate feedback length
    if (body.feedbackPositivo.length < 140 || body.feedbackConstrutivo.length < 140) {
      throw new Error('Feedbacks devem ter no mínimo 140 caracteres cada');
    }

    // Calculate average rating
    const scores = Object.values(body.scores);
    const avgRating = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Insert evaluation
    const { data: evaluation, error: evalError } = await supabase
      .from('action_evaluations')
      .insert({
        event_id: body.eventId,
        reviewer_id: user.id,
        reviewer_role: role,
        reviewer_level: reviewerLevel,
        scores: body.scores,
        rating: avgRating,
        feedback_positivo: body.feedbackPositivo,
        feedback_construtivo: body.feedbackConstrutivo,
        attachments: body.attachments || []
      })
      .select()
      .single();

    if (evalError) throw evalError;

    // Update SLA tracking
    const updateField = reviewerLevel === 'coordenacao' 
      ? 'coord_evaluated_at' 
      : 'division_evaluated_at';
    
    await supabase
      .from('evaluation_sla')
      .update({ [updateField]: new Date().toISOString() })
      .eq('event_id', body.eventId);

    // Check if both evaluations are complete (2L)
    const { count } = await supabase
      .from('action_evaluations')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', body.eventId);

    let consolidated = null;
    if (count === 2) {
      // Consolidate final rating (34% Coord + 66% Division)
      const { data: consolidationResult, error: consolidateError } = await supabase.rpc(
        'consolidate_2l_evaluation',
        { _event_id: body.eventId }
      );

      if (consolidateError) {
        console.error('Error consolidating:', consolidateError);
      } else {
        consolidated = consolidationResult;

        // Notify the user who submitted the action
        const { data: eventData } = await supabase
          .from('events')
          .select('user_id')
          .eq('id', body.eventId)
          .single();

        if (eventData?.user_id) {
          await supabase.rpc('create_notification', {
            _user_id: eventData.user_id,
            _type: 'evaluation_complete',
            _title: 'Avaliação Concluída',
            _message: `Sua ação foi avaliada! Nota final: ${consolidationResult.final_rating.toFixed(2)}/5.0`,
            _metadata: { event_id: body.eventId, ...consolidationResult }
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        evaluation,
        consolidated,
        message: consolidated ? 'Avaliação consolidada!' : 'Avaliação registrada. Aguardando segunda avaliação.'
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
