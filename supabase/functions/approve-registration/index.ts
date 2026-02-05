// @ts-expect-error Deno resolves remote modules at runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ApprovalRequest {
  registrationId: string;
  notes?: string;
  roles?: string[];
  assign_content_curator?: boolean;
  override_sigla_area?: string;
  override_operational_base?: string;
  force_guest?: boolean;
}

const GUEST_TEAM_ID = 'CONVIDADOS'
const normTeamCode = (raw?: string | null) =>
  String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)

Deno.serve(async (req: Request) => {
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
    const { data: rolesRows, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (rolesError) throw rolesError;

    const hasPermission = rolesRows?.some((r: { role: string }) =>
      ['admin', 'coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt'].includes(r.role)
    );

    if (!hasPermission) {
      throw new Error('Insufficient permissions');
    }

    const body = await req.json() as ApprovalRequest;
    const { registrationId, notes, assign_content_curator } = body;

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

    if (!registration.date_of_birth) {
      throw new Error('Data de nascimento ausente na solicitação. Peça ao usuário para reenviar o cadastro.');
    }

    const overrideSiglaRaw = typeof body.override_sigla_area === 'string' ? body.override_sigla_area : null
    const overrideBaseRaw = typeof body.override_operational_base === 'string' ? body.override_operational_base : null
    const forceGuest =
      Boolean(body.force_guest) ||
      String(overrideSiglaRaw || '').trim().toUpperCase() === GUEST_TEAM_ID ||
      String(overrideBaseRaw || '').trim().toUpperCase() === GUEST_TEAM_ID

    const desiredSigla = forceGuest
      ? GUEST_TEAM_ID
      : normTeamCode(overrideSiglaRaw || registration.sigla_area) || normTeamCode(registration.sigla_area)
    const desiredBase = forceGuest
      ? GUEST_TEAM_ID
      : String(overrideBaseRaw || registration.operational_base || '').trim().slice(0, 80)
    if (!desiredSigla) {
      throw new Error('Sigla/base inválida. Ajuste antes de aprovar.');
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
        phone: registration.telefone || null,
        operational_base: desiredBase || registration.operational_base,
        sigla_area: desiredSigla,
        must_change_password: true,
        needs_profile_completion: true,
        date_of_birth: registration.date_of_birth,
      }, { onConflict: 'id' });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Cleanup: delete auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw profileError;
    }

    console.log('Profile created');

    const regSigla = String(desiredSigla || '').trim().toUpperCase()
    const isGuest = regSigla === 'EXTERNO' || regSigla === GUEST_TEAM_ID

    const ensureTeamExists = async (teamId: string, name: string) => {
      if (!teamId) return
      try {
        const { data: existing } = await supabaseAdmin.from('teams').select('id').eq('id', teamId).maybeSingle()
        if (existing?.id) return
        await supabaseAdmin.from('teams').insert({ id: teamId, name } as any)
      } catch (e) {
        console.warn('Could not ensure team exists:', teamId, e)
      }
    }

    if (isGuest) {
      // Garantia: convidado entra como colaborador comum e fica sob "CONVIDADOS",
      // sem compor hierarquia (sem divisão/coord) e sem exigir base específica.
      await ensureTeamExists(GUEST_TEAM_ID, 'Convidados (externo)')
      await supabaseAdmin
        .from('profiles')
        .update({
          sigla_area: GUEST_TEAM_ID,
          operational_base: GUEST_TEAM_ID,
          team_id: GUEST_TEAM_ID,
          coord_id: null,
          division_id: null,
        } as any)
        .eq('id', newUser.user.id)
    } else {
      // Garantia: o valor do cadastro (sigla_area) também existe como teams.id,
      // para que perfis possam referenciar team_id sem falhar FK.
      if (regSigla) await ensureTeamExists(regSigla, regSigla)

      // Attach org hierarchy if possible
      const org = await deriveOrgUnits(desiredSigla || desiredBase || registration.sigla_area || registration.operational_base)
      if (org) {
        const { error: orgErr } = await supabaseAdmin
          .from('profiles')
          .update({ division_id: org.divisionId, coord_id: org.coordinationId, team_id: org.teamId })
          .eq('id', newUser.user.id)
        if (orgErr) {
          console.warn('Could not attach org hierarchy:', orgErr.message)
        }
      } else if (regSigla) {
        await supabaseAdmin.from('profiles').update({ team_id: regSigla } as any).eq('id', newUser.user.id)
      }
    }

    // Assign roles: invited (guest) or colaborador (internal), plus optional content_curator
    const requestedRoles = Array.isArray(body.roles)
      ? body.roles.map((r: string) => String(r || '').trim()).filter(Boolean)
      : []
    const wantsCurator = Boolean(assign_content_curator) || requestedRoles.includes('content_curator')
    const requestedProfile = String((registration as any)?.requested_profile || '').trim().toLowerCase()
    const wantsLeader = !isGuest && (requestedRoles.includes('lider_equipe') || requestedProfile === 'leader')
    const baseRole = isGuest ? 'invited' : 'colaborador'
    const rolesToAssign = Array.from(new Set([
      baseRole,
      ...(wantsLeader ? ['lider_equipe'] : []),
      ...(wantsCurator ? ['content_curator'] : []),
    ]))

    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert(rolesToAssign.map((role) => ({ user_id: newUser.user.id, role } as any)) as any);
    if (roleError) {
      const msg = String((roleError as any).message || '').toLowerCase()
      const code = String((roleError as any).code || '')
      const isDup = code === '23505' || msg.includes('duplicate')
      if (!isDup) {
        console.error('Error assigning role:', roleError)
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
        throw roleError
      }
    }

    console.log('Role assigned');

    if (wantsLeader) {
      try {
        await supabaseAdmin.from('profiles').update({ is_leader: true } as any).eq('id', newUser.user.id)
      } catch {
        // ignore
      }
    }

    // Update registration status
    const { error: updateError } = await supabaseAdmin
      .from('pending_registrations')
      .update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
        sigla_area: desiredSigla,
        operational_base: desiredBase || registration.operational_base,
      })
      .eq('id', registrationId);

    if (updateError) {
      console.error('Error updating registration:', updateError);
      throw updateError;
    }

    console.log('Registration approved successfully');

    // Audit (best-effort)
    try {
      await supabaseAdmin.from('audit_log').insert({
        actor_id: user.id,
        action: 'registration.approve',
        entity_type: 'pending_registration',
        entity_id: String(registrationId),
        before_json: registration as any,
        after_json: { user_id: newUser.user.id, roles: rolesToAssign, is_leader: wantsLeader, sigla_area: desiredSigla, operational_base: desiredBase || registration.operational_base } as any,
      } as any)
    } catch {
      // ignore
    }

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
