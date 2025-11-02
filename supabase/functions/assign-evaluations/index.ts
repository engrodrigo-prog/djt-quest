import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const { eventId, excludeCoordinations, excludeUserId } = body;

    console.log('Assigning evaluation for event:', eventId);

    // Buscar evento com dados do colaborador
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        *,
        user:profiles!events_user_id_fkey(id, coord_id, team_id),
        challenge:challenges(require_two_leader_eval)
      `)
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      throw new Error('Evento não encontrado');
    }

    const collaborator = event.user;

    // Detectar se é 1ª ou 2ª avaliação
    const { count: evalCount } = await supabase
      .from('action_evaluations')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId);

    const isSecondEvaluation = (evalCount || 0) >= 1;

    console.log('Is second evaluation:', isSecondEvaluation);

    // Buscar coordenadores disponíveis
    const { data: allCoordinators, error: coordError } = await supabase
      .from('profiles')
      .select('id, name, coord_id, team_id')
      .eq('is_leader', true)
      .neq('id', collaborator.id);

    if (coordError || !allCoordinators || allCoordinators.length === 0) {
      throw new Error('Nenhum coordenador disponível');
    }

    // Filtrar coordenadores elegíveis
    const eligibleCoordinators = allCoordinators.filter(coord => {
      // Sempre excluir coordenações especificadas
      if (excludeCoordinations && excludeCoordinations.includes(coord.coord_id)) {
        return false;
      }

      // Sempre excluir o usuário especificado
      if (excludeUserId && coord.id === excludeUserId) {
        return false;
      }

      // Sempre diferente da coordenação do colaborador
      if (coord.coord_id === collaborator.coord_id) {
        return false;
      }

      return true;
    });

    if (eligibleCoordinators.length === 0) {
      throw new Error('Nenhum coordenador elegível encontrado para avaliação cruzada');
    }

    console.log(`Found ${eligibleCoordinators.length} eligible coordinators`);

    // Contar avaliações pendentes para cada coordenador
    const coordinatorLoads = await Promise.all(
      eligibleCoordinators.map(async (coord) => {
        const { count } = await supabase
          .from('evaluation_queue')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_to', coord.id)
          .is('completed_at', null);

        return {
          ...coord,
          pending_count: count || 0
        };
      })
    );

    // Ordenar por menor carga de trabalho
    coordinatorLoads.sort((a, b) => a.pending_count - b.pending_count);

    // Selecionar o coordenador com menor carga
    const selectedCoordinator = coordinatorLoads[0];

    console.log('Selected coordinator:', selectedCoordinator.name, 'with', selectedCoordinator.pending_count, 'pending evaluations');

    // Inserir na fila de avaliações
    const { error: queueError } = await supabase
      .from('evaluation_queue')
      .insert({
        event_id: eventId,
        assigned_to: selectedCoordinator.id,
        assigned_at: new Date().toISOString(),
        is_cross_evaluation: true
      });

    if (queueError) {
      console.error('Error inserting into queue:', queueError);
      throw new Error('Erro ao atribuir avaliação');
    }

    // Atualizar evento
    const updateData: any = {
      assigned_evaluator_id: selectedCoordinator.id,
      assignment_type: isSecondEvaluation ? 'second_evaluation' : 'first_evaluation'
    };

    if (!isSecondEvaluation) {
      updateData.status = 'submitted';
    }

    await supabase
      .from('events')
      .update(updateData)
      .eq('id', eventId);

    // Notificar avaliador
    await supabase.rpc('create_notification', {
      _user_id: selectedCoordinator.id,
      _type: 'evaluation_assigned',
      _title: isSecondEvaluation ? '📋 2ª Avaliação Atribuída' : '📋 Nova Avaliação Atribuída',
      _message: `Você foi designado para ${isSecondEvaluation ? 'a 2ª ' : ''}avaliar uma ação.`,
      _metadata: {
        event_id: eventId,
        evaluation_number: isSecondEvaluation ? 2 : 1
      }
    });

    console.log('Assignment completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        assigned_to: selectedCoordinator.id,
        coordinator_name: selectedCoordinator.name,
        evaluation_number: isSecondEvaluation ? 2 : 1
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in assign-evaluations:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
