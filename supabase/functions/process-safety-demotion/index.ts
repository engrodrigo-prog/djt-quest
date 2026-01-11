import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DemotionRequest {
  userId: string;
  incidentId: string;
  cooldownDays?: number;
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

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (!user) {
      throw new Error('Unauthorized');
    }

    const { userId, incidentId, cooldownDays = 7 }: DemotionRequest = await req.json();

    console.log(`Processing demotion for user ${userId} due to incident ${incidentId}`);

    const { data: demotionResult, error: demotionError } = await supabase.rpc(
      'demote_for_safety_incident',
      {
        _user_id: userId,
        _incident_id: incidentId,
        _demoted_by: user.id,
        _cooldown_days: cooldownDays
      }
    );

    if (demotionError) throw demotionError;

    console.log('Demotion result:', demotionResult);

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email, team_id, tier')
      .eq('id', userId)
      .single();

    const { data: team } = await supabase
      .from('teams')
      .select('coordination_id')
      .eq('id', profile?.team_id)
      .single();

    if (demotionResult.success) {
      await supabase.rpc('create_notification', {
        _user_id: userId,
        _type: 'demotion',
        _title: 'Rebaixamento por Segurança',
        _message: `Você foi rebaixado para ${demotionResult.new_tier} devido a um incidente de segurança. Revise os feedbacks e melhore suas práticas.`,
        _metadata: {
          previous_tier: demotionResult.previous_tier,
          new_tier: demotionResult.new_tier,
          cooldown_until: demotionResult.cooldown_until,
          incident_id: incidentId
        }
      });

      const { data: coordinator } = await supabase
        .from('profiles')
        .select('id')
        .eq('team_id', profile?.team_id)
        .limit(1)
        .single();

      if (coordinator) {
        await supabase.rpc('create_notification', {
          _user_id: coordinator.id,
          _type: 'team_demotion',
          _title: 'Membro da Equipe Rebaixado',
          _message: `${profile?.name} foi rebaixado para ${demotionResult.new_tier} por incidente de segurança.`,
          _metadata: {
            affected_user_id: userId,
            previous_tier: demotionResult.previous_tier,
            new_tier: demotionResult.new_tier
          }
        });
      }

      const { data: managers } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'gerente');

      for (const manager of managers || []) {
        await supabase.rpc('create_notification', {
          _user_id: manager.user_id,
          _type: 'safety_alert',
          _title: 'Alerta de Segurança - Rebaixamento',
          _message: `Colaborador ${profile?.name} rebaixado por incidente de segurança.`,
          _metadata: {
            affected_user_id: userId,
            incident_id: incidentId
          }
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        result: demotionResult 
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  } catch (error: any) {
    console.error('Error processing demotion:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
