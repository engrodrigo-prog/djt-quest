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

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (!user) throw new Error('Unauthorized');

    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, name, team_id')
      .eq('id', user.id)
      .single();

    if (!profile) throw new Error('Profile not found');

    const currentTier = profile.tier;
    const tierPrefix = currentTier.split('-')[0];
    const levelNum = parseInt(currentTier.split('-')[1]);

    if (levelNum !== 5) {
      throw new Error('Must be at level 5 to request tier progression');
    }

    let targetTier: string;
    if (tierPrefix === 'EX') targetTier = 'FO-1';
    else if (tierPrefix === 'FO') targetTier = 'GU-1';
    else throw new Error('Already at maximum tier');

    const { data: team } = await supabase
      .from('teams')
      .select('coordination_id')
      .eq('id', profile.team_id)
      .single();

    const { data: request, error: requestError } = await supabase
      .from('tier_progression_requests')
      .insert({
        user_id: user.id,
        current_tier: currentTier,
        target_tier: targetTier,
        status: 'pending'
      })
      .select()
      .single();

    if (requestError) throw requestError;

    const { data: coordinators } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'coordenador');

    for (const coord of coordinators || []) {
      await supabase.rpc('create_notification', {
        _user_id: coord.user_id,
        _type: 'tier_progression_request',
        _title: 'Nova Solicitação de Progressão',
        _message: `${profile.name} solicitou progressão de ${currentTier} para ${targetTier}. Crie um desafio especial para avaliação.`,
        _metadata: {
          request_id: request.id,
          user_id: user.id,
          current_tier: currentTier,
          target_tier: targetTier
        }
      });
    }

    await supabase.rpc('create_notification', {
      _user_id: user.id,
      _type: 'tier_progression_pending',
      _title: 'Solicitação Enviada!',
      _message: `Sua solicitação de progressão para ${targetTier === 'FO-1' ? 'Formador' : 'Guardião'} foi enviada ao seu coordenador.`,
      _metadata: {
        request_id: request.id
      }
    });

    return new Response(
      JSON.stringify({ success: true, request }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error requesting tier progression:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
