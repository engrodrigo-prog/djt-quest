import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TeamEventRequest {
  teamId: string;
  eventType: 'reconhecimento' | 'ponto_atencao';
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

    // Verificar permissões baseadas em hierarquia
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_leader, team_id, coord_id, division_id, department_id')
      .eq('id', user.id)
      .single();

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const userRoles = new Set((roles || []).map((r: any) => String(r.role)));
    const isAdmin = userRoles.has('admin');
    const isGerenteDjt = userRoles.has('gerente_djt');
    const isGerenteDivisao = userRoles.has('gerente_divisao_djtx');
    const isCoordenador = userRoles.has('coordenador_djtx');

    // Buscar dados da equipe alvo
    const { data: targetTeam } = await supabase
      .from('teams')
      .select(`
        id,
        coordination_id,
        coordinations (
          division_id
        )
      `)
      .eq('id', body.teamId)
      .single();

    // Validação hierárquica
    if (isAdmin || isGerenteDjt) {
      // Gerente DJT pode tudo
    } else if (isGerenteDivisao) {
      if (targetTeam?.coordinations?.[0]?.division_id !== profile?.division_id) {
        throw new Error('Você só pode bonificar equipes da sua divisão');
      }
    } else if (isCoordenador) {
      if (targetTeam?.coordination_id !== profile?.coord_id) {
        throw new Error('Você só pode bonificar equipes da sua coordenação');
      }
    } else if (profile?.is_leader && profile?.team_id === body.teamId) {
      // Líder de equipe pode bonificar apenas sua equipe
    } else {
      throw new Error('Você não tem permissão para criar eventos para esta equipe');
    }

    // Validações
    if (body.eventType === 'reconhecimento' && body.points <= 0) {
      throw new Error('Pontos devem ser positivos para reconhecimento');
    }

    if (body.eventType === 'ponto_atencao') {
      body.points = 0; // Forçar pontos = 0 para ponto de atenção
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

    // Atualizar XP de cada colaborador (apenas para reconhecimento)
    const pointsDelta = body.eventType === 'reconhecimento' ? body.points : 0;
    
    const updates = await Promise.all(
      collaborators.map(async (collab) => {
        if (pointsDelta > 0) {
          try {
            await supabase.rpc('increment_user_xp', { _user_id: collab.id, _xp_to_add: pointsDelta });
          } catch (updateError) {
            console.error('Error updating XP for user:', collab.id, updateError);
            // fallback antigo (não atualiza tier)
            const newXp = (collab.xp || 0) + pointsDelta;
            await supabase.from('profiles').update({ xp: newXp }).eq('id', collab.id);
          }
        }

        return { userId: collab.id, oldXp: collab.xp, newXp: (collab.xp || 0) + pointsDelta };
      })
    );

    // Criar notificações para todos os colaboradores
    const notificationMessage = body.eventType === 'reconhecimento'
      ? `🎉 Sua equipe recebeu reconhecimento: +${body.points} XP! ${body.reason}`
      : `⚠️ Ponto de atenção registrado para sua equipe. ${body.reason}`;

    await Promise.all(
      affectedUserIds.map(userId =>
        supabase.rpc('create_notification', {
          _user_id: userId,
          _type: 'team_event',
          _title: body.eventType === 'reconhecimento' ? '🎉 Reconhecimento de Equipe' : '⚠️ Ponto de Atenção',
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
        message: body.eventType === 'reconhecimento' 
          ? `🎉 Reconhecimento de ${body.points} XP aplicado a ${affectedUserIds.length} colaboradores`
          : `⚠️ Ponto de atenção registrado para ${affectedUserIds.length} colaboradores`
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
