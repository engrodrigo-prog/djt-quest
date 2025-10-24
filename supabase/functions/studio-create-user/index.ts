import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Não autorizado');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader }
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      throw new Error('Usuário não autenticado');
    }

    // Verify caller has permission (gerente_djt, lider_divisao_djtx, coordenador_djtx)
    const { data: callerRoles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const allowedRoles = ['gerente_djt', 'lider_divisao_djtx', 'coordenador_djtx'];
    const hasPermission = callerRoles?.some(r => allowedRoles.includes(r.role));

    if (!hasPermission) {
      throw new Error('Você não tem permissão para criar usuários');
    }

    console.log('Creating user by:', user.id);

    const { email, password, name, team_id, role } = await req.json();

    if (!email || !password || !name || !role) {
      throw new Error('Campos obrigatórios faltando: email, password, name, role');
    }

    // Create auth user using admin API
    const { data: newUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      throw authError;
    }

    if (!newUser.user) {
      throw new Error('Falha ao criar usuário');
    }

    console.log('Auth user created:', newUser.user.id);

    // Create profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: newUser.user.id,
        email,
        name,
        team_id: team_id || null,
        xp: 0,
        tier: 'EX-1'
      });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Try to delete the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw profileError;
    }

    console.log('Profile created for:', newUser.user.id);

    // Assign role
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: newUser.user.id,
        role
      });

    if (roleError) {
      console.error('Error assigning role:', roleError);
      // Cleanup
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw roleError;
    }

    console.log('Role assigned to:', newUser.user.id, 'role:', role);

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser.user.id,
          email,
          name,
          role
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in studio-create-user:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
