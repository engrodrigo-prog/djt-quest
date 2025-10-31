import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { field_name, new_value } = await req.json();

    if (!field_name || !new_value) {
      throw new Error('Missing field_name or new_value');
    }

    // Verificar se usuário é admin
    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isAdmin = roles?.some(r => r.role === 'admin');

    if (isAdmin) {
      // Admin pode editar direto
      const { data: currentProfile } = await supabaseClient
        .from('profiles')
        .select(field_name)
        .eq('id', user.id)
        .single();

      const { error: updateError } = await supabaseClient
        .from('profiles')
        .update({ [field_name]: new_value })
        .eq('id', user.id);

      if (updateError) throw updateError;

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Profile updated directly (admin privilege)',
          updated_immediately: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar valor atual
    const { data: currentProfile } = await supabaseClient
      .from('profiles')
      .select(field_name)
      .eq('id', user.id)
      .single();

    // Criar solicitação
    const { error: insertError } = await supabaseClient
      .from('profile_change_requests')
      .insert({
        user_id: user.id,
        requested_by: user.id,
        field_name,
        old_value: currentProfile?.[field_name] || null,
        new_value,
        status: 'pending',
      });

    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Change request created successfully',
        requires_approval: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in request-profile-change:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
