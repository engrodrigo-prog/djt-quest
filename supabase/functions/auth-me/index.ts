import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseAuth = createClient(
      supabaseUrl,
      supabaseAnonKey,
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

    // Client privilegiado:
    // - Prefer service role para bypass de RLS (necessário para ler user_roles e enriquecer orgScope).
    // - Se não houver service key, faz fallback para modo "as user" (pode falhar dependendo de RLS).
    const supabase = supabaseServiceRoleKey
      ? createClient(supabaseUrl, supabaseServiceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        });

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
    // Compat: aceita nomes legados usados em migrações antigas.
    const roleHierarchy = [
      'admin',
      'gerente_djt',
      'gerente',
      'gerente_divisao_djtx',
      'lider_divisao',
      'coordenador_djtx',
      'coordenador',
      'lider_equipe',
      'analista_financeiro',
      'content_curator',
      'colaborador',
      'invited',
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

    // Normalizar roles legados para os literais atuais do app
    const normalizeRole = (r: string) => {
      if (r === 'gerente') return 'gerente_djt';
      if (r === 'lider_divisao') return 'gerente_divisao_djtx';
      if (r === 'coordenador') return 'coordenador_djtx';
      return r;
    };
    role = normalizeRole(role);

    const privilegedRoles = new Set([
      'admin',
      'gerente_djt',
      'gerente_divisao_djtx',
      'coordenador_djtx',
      'lider_equipe',
    ]);

    // Considera flags do perfil como fallback (ambientes onde user_roles não é legível via RLS).
    const userRoles = (rolesData || []).map((r) => String(r?.role || ''));
    // Guests can be granted "curation-only" Studio access via profile flag.
    const invitedCurator = Boolean(profile?.studio_access) && userRoles.includes('invited');
    const hasContentCurator = userRoles.includes('content_curator') || invitedCurator;
    const hasFinanceAnalyst = userRoles.includes('analista_financeiro');
    const isLeader = Boolean(profile?.is_leader) || privilegedRoles.has(role);
    const studioAccess = Boolean(profile?.studio_access) || privilegedRoles.has(role) || hasContentCurator || hasFinanceAnalyst;

    // If this is an invited curator (no explicit role), treat primary role as content_curator
    // to keep the UX consistent (Studio redirects straight to /studio/curadoria).
    if (role === 'invited' && invitedCurator) {
      role = 'content_curator';
    }

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
        roles: userRoles,
        studioAccess,
        isLeader,
        isContentCurator: hasContentCurator,
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
