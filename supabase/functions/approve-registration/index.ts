import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ApprovalRequest {
  registrationId: string;
  notes?: string;
}

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
          persistSession: false,
        },
      }
    );

    // Derive org units by looking up teams/coord tables
    const deriveOrgUnits = async (raw: string | null | undefined) => {
      if (!raw) return null
      const normalized = String(raw)
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
      if (!normalized) return null

      // 1) Try direct lookup: teams.id equals normalized (base code like CUB, SAN, ITP, PLA...)
      let teamId: string | null = null
      let coordId: string | null = null
      let divisionId: string | null = null
      {
        const { data: team } = await supabaseAdmin
          .from('teams')
          .select('id, coord_id')
          .eq('id', normalized)
          .maybeSingle()
        if (team?.id) {
          teamId = team.id
          coordId = team.coord_id || null
          if (coordId) {
            const { data: coord } = await supabaseAdmin
              .from('coordinations')
              .select('division_id')
              .eq('id', coordId)
              .maybeSingle()
            divisionId = coord?.division_id || null
          }
        }
      }

      // 2) Fallback: string like DJTB-CUB
      if (!teamId && normalized.includes('-')) {
        const [div, tag] = normalized.split('-', 2)
        divisionId = div || null
        coordId = div && tag ? `${div}-${tag}` : null
        // Try to find team by base tag under this coord
        if (tag) {
          const { data: t2 } = await supabaseAdmin
            .from('teams')
            .select('id')
            .eq('id', tag)
            .maybeSingle()
          if (t2?.id) teamId = t2.id
        }
      }

      if (!divisionId && teamId) {
        // As a last resort, deduce division from coord again
        const { data: team } = await supabaseAdmin
          .from('teams')
          .select('coord_id')
          .eq('id', teamId)
          .maybeSingle()
        if (team?.coord_id) {
          const { data: coord } = await supabaseAdmin
            .from('coordinations')
            .select('division_id')
            .eq('id', team.coord_id)
            .maybeSingle()
          coordId = coordId || team.coord_id
          divisionId = coord?.division_id || null
        }
      }

      if (!divisionId && !coordId && !teamId) return null
      return { divisionId, coordinationId: coordId, teamId }
    }

    // Get authenticated user
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if user has permission (coordinator or higher)
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (rolesError) throw rolesError;

    const hasPermission = roles?.some(r => 
      ['coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt'].includes(r.role)
    );

    if (!hasPermission) {
      throw new Error('Insufficient permissions');
    }

    const { registrationId, notes } = await req.json() as ApprovalRequest;

    // Fetch pending registration
    const { data: registration, error: fetchError } = await supabaseAdmin
      .from('pending_registrations')
      .select('*')
      .eq('id', registrationId)
      .eq('status', 'pending')
      .single();

    if (fetchError || !registration) {
      throw new Error('Registration not found or already processed');
    }

    // Prevent duplicate approvals for same email
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', registration.email)
      .maybeSingle()
    if (existingProfile?.id) {
      throw new Error('Já existe um perfil ativo com este e-mail. Rejeite ou atualize o cadastro existente.');
    }

    console.log('Creating user:', registration.email);

    // Create user in Supabase Auth with default password
    const { data: newUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email: registration.email,
      password: '123456',
      email_confirm: true,
      user_metadata: {
        name: registration.name,
      },
    });

    if (createUserError) {
      console.error('Error creating auth user:', createUserError);
      throw createUserError;
    }

    console.log('User created:', newUser.user.id);

    // Create or update profile (avoid duplicate key on retries)
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        name: registration.name,
        email: registration.email,
        matricula: registration.matricula,
        operational_base: registration.operational_base,
        sigla_area: registration.sigla_area,
        must_change_password: true,
        needs_profile_completion: true,
      }, { onConflict: 'id' });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Cleanup: delete auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw profileError;
    }

    console.log('Profile created');

    // Attach org hierarchy if possible
    const org = await deriveOrgUnits(registration.sigla_area || registration.operational_base)
    if (org) {
      const { error: orgErr } = await supabaseAdmin
        .from('profiles')
        .update({ division_id: org.divisionId, coord_id: org.coordinationId, team_id: org.teamId })
        .eq('id', newUser.user.id)
      if (orgErr) {
        console.warn('Could not attach org hierarchy:', orgErr.message)
      }
    }

    // Assign default role (colaborador)
    // Assign default role; ignore if already assigned
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({ user_id: newUser.user.id, role: 'colaborador' });
    if (roleError && !String(roleError.message || '').toLowerCase().includes('duplicate')) {
      console.error('Error assigning role:', roleError)
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw roleError;
    }

    if (roleError) {
      console.error('Error assigning role:', roleError);
      // Cleanup
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw roleError;
    }

    console.log('Role assigned');

    // Update registration status
    const { error: updateError } = await supabaseAdmin
      .from('pending_registrations')
      .update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
      })
      .eq('id', registrationId);

    if (updateError) {
      console.error('Error updating registration:', updateError);
      throw updateError;
    }

    console.log('Registration approved successfully');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Registration approved successfully',
        userId: newUser.user.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in approve-registration:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : undefined,
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
