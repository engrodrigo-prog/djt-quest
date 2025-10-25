import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TeamEventRequest {
  teamId: string;
  eventType: 'bonus' | 'penalty';
  points: number;
  reason: string;
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

    const body: TeamEventRequest = await req.json();

    console.log('Processing team event:', { userId: user.id, ...body });

    // Validar que o usuário é líder da equipe
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_leader, team_id')
      .eq('id', user.id)
      .single();

    if (!profile?.is_leader) {
      throw new Error('Apenas líderes podem criar eventos de equipe');
    }

    if (profile.team_id !== body.teamId) {
      throw new Error('Você só pode criar eventos para sua própria equipe');
    }

    // Validações
    if (body.points <= 0) {
      throw new Error('Pontos devem ser positivos');
    }

    if (body.reason.length < 50) {
      throw new Error('A justificativa deve ter no mínimo 50 caracteres');
    }

    // Buscar colaboradores da equipe (excluir líderes)
    const { data: collaborators, error: collabError } = await supabase
      .from('profiles')
      .select('id, name, xp')
      .eq('team_id', body.teamId)
      .eq('is_leader', false);

    if (collabError) throw collabError;

    if (!collaborators || collaborators.length === 0) {
      throw new Error('Nenhum colaborador encontrado nesta equipe');
    }

    const affectedUserIds = collaborators.map(c => c.id);

    // Registrar evento de equipe
    const { data: teamEvent, error: eventError } = await supabase
      .from('team_events')
      .insert({
        team_id: body.teamId,
        created_by: user.id,
        event_type: body.eventType,
        points: body.points,
        reason: body.reason,
        affected_users: affectedUserIds
      })
      .select()
      .single();

    if (eventError) throw eventError;

    // Atualizar XP de cada colaborador
    const pointsDelta = body.eventType === 'bonus' ? body.points : -body.points;
    
    const updates = await Promise.all(
      collaborators.map(async (collab) => {
        const newXp = Math.max(0, collab.xp + pointsDelta);
        
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ xp: newXp })
          .eq('id', collab.id);

        if (updateError) {
          console.error('Error updating XP for user:', collab.id, updateError);
        }

        return { userId: collab.id, oldXp: collab.xp, newXp };
      })
    );

    // Criar notificações para todos os colaboradores
    const notificationMessage = body.eventType === 'bonus'
      ? `🎉 Sua equipe ganhou +${body.points} XP! ${body.reason}`
      : `⚠️ Sua equipe perdeu -${body.points} XP. ${body.reason}`;

    await Promise.all(
      affectedUserIds.map(userId =>
        supabase.rpc('create_notification', {
          _user_id: userId,
          _type: 'team_event',
          _title: body.eventType === 'bonus' ? 'Bônus de Equipe' : 'Penalidade de Equipe',
          _message: notificationMessage,
          _metadata: { 
            team_event_id: teamEvent.id,
            points: body.points,
            event_type: body.eventType
          }
        })
      )
    );

    console.log('Team event created successfully:', {
      eventId: teamEvent.id,
      affectedUsers: affectedUserIds.length,
      updates
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        event: teamEvent,
        affectedUsers: affectedUserIds.length,
        updates,
        message: `${body.eventType === 'bonus' ? 'Bônus' : 'Penalidade'} aplicado a ${affectedUserIds.length} colaboradores`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in create-team-event:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
