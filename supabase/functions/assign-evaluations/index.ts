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
    const { eventId } = body;

    console.log('Assigning evaluation for event:', eventId);
    if (!eventId) throw new Error('eventId obrigatório');

    // Delegate assignment to the DB function (idempotent; assigns leader imediato + líder randômico)
    await supabase.rpc('assign_evaluators_for_event', { _event_id: eventId });

    const { data: rows } = await supabase
      .from('evaluation_queue')
      .select('id,event_id,assigned_to,assigned_at,completed_at,is_cross_evaluation')
      .eq('event_id', eventId)
      .order('assigned_at', { ascending: true });

    console.log('Assignment completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        items: rows || []
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
