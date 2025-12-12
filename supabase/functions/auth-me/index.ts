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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Client privilegiado para ler tabelas internas com RLS respeitando auth.uid()
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    );

    // Fetch ALL user roles
    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    // Fetch complete profile with organizational data
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    let teamRecord: { id: string; name: string; coord_id: string | null } | null = null;
    let coordRecord: { id: string; name: string; division_id: string | null } | null = null;
    let divisionRecord: { id: string; name: string; department_id: string | null } | null = null;

    if (profile?.team_id) {
      const { data } = await supabase
        .from('teams')
        .select('id, name, coord_id')
        .eq('id', profile.team_id)
        .maybeSingle();
      teamRecord = data;
    }

    const coordId = profile?.coord_id || teamRecord?.coord_id;
    if (coordId) {
      const { data } = await supabase
        .from('coordinations')
        .select('id, name, division_id')
        .eq('id', coordId)
        .maybeSingle();
      coordRecord = data;
    }

    const divisionId = profile?.division_id || coordRecord?.division_id;
    if (divisionId) {
      const { data } = await supabase
        .from('divisions')
        .select('id, name, department_id')
        .eq('id', divisionId)
        .maybeSingle();
      divisionRecord = data;
    }

    // Define role hierarchy (highest to lowest privilege)
    // NOTE: keep in sync with frontend guards (allowed roles include 'admin').
    const roleHierarchy = [
      'admin',
      'gerente_djt',
      'gerente_divisao_djtx',
      'coordenador_djtx',
      'lider_equipe',
      'colaborador',
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
    const privilegedRoles = new Set([
      'admin',
      'gerente_djt',
      'gerente_divisao_djtx',
      'coordenador_djtx',
      'lider_equipe',
    ]);
    const isLeader = Boolean(profile?.is_leader) || privilegedRoles.has(role);
    const studioAccess = Boolean(profile?.studio_access) || privilegedRoles.has(role);

    // Build organizational scope
    const orgScope = {
      teamId: profile?.team_id || null,
      teamName: teamRecord?.name,
      coordId: coordRecord?.id || profile?.coord_id || null,
      coordName: coordRecord?.name,
      divisionId: divisionRecord?.id || profile?.division_id || null,
      divisionName: divisionRecord?.name,
      departmentId: profile?.department_id || divisionRecord?.department_id || 'DJT'
    };

    const enrichedProfile = profile
      ? {
          ...profile,
          team: teamRecord ? { id: teamRecord.id, name: teamRecord.name } : null,
        }
      : null;

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
        profile: enrichedProfile
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
