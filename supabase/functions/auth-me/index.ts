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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Fetch ALL user roles
    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    // Fetch complete profile with organizational data
    const { data: profile } = await supabase
      .from('profiles')
      .select(`
        *,
        teams (
          id, name,
          coordinations (
            id, name,
            divisions (id, name, department_id)
          )
        )
      `)
      .eq('id', user.id)
      .single();

    // Define role hierarchy (highest to lowest privilege)
    const roleHierarchy = [
      'gerente_djt',
      'gerente_divisao_djtx',
      'coordenador_djtx',
      'lider_equipe',
      'colaborador'
    ];

    // Get the highest privilege role
    let role = 'colaborador';
    if (rolesData && rolesData.length > 0) {
      const userRoles = rolesData.map(r => r.role);
      for (const hierarchyRole of roleHierarchy) {
        if (userRoles.includes(hierarchyRole)) {
          role = hierarchyRole;
          break;
        }
      }
    }
    const studioAccess = profile?.studio_access || false;
    const isLeader = profile?.is_leader || false;

    // Build organizational scope
    const orgScope = {
      teamId: profile?.team_id || null,
      coordId: profile?.coord_id || null,
      divisionId: profile?.division_id || 'DJTX',
      departmentId: profile?.department_id || 'DJT'
    };

    return new Response(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          name: profile?.name || user.email
        },
        role,
        studioAccess,
        isLeader,
        orgScope,
        profile
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in auth-me:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
