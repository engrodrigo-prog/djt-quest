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

    // Simple org derivation (Divisão -> Coordenação -> Equipe) based on sigla
    const deriveOrgUnits = (raw: string | null | undefined) => {
      if (!raw) return null
      const normalized = String(raw)
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
      if (!normalized) return null
      const parts = normalized.split('-').filter(Boolean)
      const divisionId = parts[0] || 'DJT'
      const coordinationTag = parts[1] || 'SEDE'
      const coordinationId = `${divisionId}-${coordinationTag}`
      const teamId = normalized
      return { divisionId, coordinationId, teamId }
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

    // Create profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: newUser.user.id,
        name: registration.name,
        email: registration.email,
        matricula: registration.matricula,
        operational_base: registration.operational_base,
        sigla_area: registration.sigla_area,
        must_change_password: true,
        needs_profile_completion: true,
      });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Cleanup: delete auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw profileError;
    }

    console.log('Profile created');

    // Attach org hierarchy if possible
    const org = deriveOrgUnits(registration.sigla_area || registration.operational_base)
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
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: newUser.user.id,
        role: 'colaborador',
      });

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
