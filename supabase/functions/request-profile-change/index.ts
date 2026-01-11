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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = serviceRoleKey
      ? createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          serviceRoleKey,
          { auth: { autoRefreshToken: false, persistSession: false } }
        )
      : null;

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    type ChangeItem = { field_name: string; new_value: string }
    const payload = await req.json();
    let changes: ChangeItem[] = []
    if (Array.isArray(payload?.changes)) {
      changes = payload.changes as ChangeItem[];
    } else if (payload?.field_name && typeof payload?.new_value !== 'undefined') {
      changes = [{ field_name: payload.field_name, new_value: payload.new_value }];
    }

    if (changes.length === 0) {
      throw new Error('Missing changes');
    }

    const allowedFields = new Set(['name', 'email', 'operational_base', 'sigla_area', 'date_of_birth', 'phone', 'telefone', 'matricula']);
    const normalizeSigla = (value: string) =>
      value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    const sanitizeChange = (field: string, value: any) => {
      if (!allowedFields.has(field)) {
        throw new Error(`Campo não suportado: ${field}`);
      }
      if (typeof value !== 'string') {
        throw new Error(`Valor inválido para ${field}`);
      }
      switch (field) {
        case 'sigla_area':
          return normalizeSigla(value);
        case 'operational_base':
          return value.trim();
        case 'name':
          return value.trim();
        case 'email':
          return value.trim().toLowerCase();
        case 'telefone':
          return value.replace(/[^0-9+()\s-]/g, '').trim();
        case 'phone':
          return value.replace(/[^0-9+()\s-]/g, '').trim();
        case 'matricula':
          return value.trim().toUpperCase();
        case 'date_of_birth':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
            throw new Error('Data de nascimento deve estar no formato YYYY-MM-DD');
          }
          return value.trim();
        default:
          return value;
      }
    };
    changes = changes.map((change) => ({
      field_name: change.field_name,
      new_value: sanitizeChange(change.field_name, change.new_value),
    }));

    let { data: currentProfile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (!currentProfile) {
      // Attempt to create a minimal profile on-the-fly (service role only)
      if (supabaseAdmin) {
        await supabaseAdmin.from('profiles').insert({ id: user.id, email: user.email, name: user.user_metadata?.name || user.email }).onConflict('id').ignore();
        const { data: created } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        currentProfile = created as any;
      }
      if (!currentProfile) {
        throw new Error('Perfil não encontrado');
      }
    }

    const { data: roleRows } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const deriveOrgUnits = (raw: string | null | undefined) => {
      if (!raw) return null;
      const normalized = raw
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (!normalized) return null;
      const parts = normalized.split('-').filter(Boolean);
      const divisionId = parts[0] || 'DJT';
      const coordinationTag = parts[1] || 'SEDE';
      return {
        divisionId,
        coordinationId: `${divisionId}-${coordinationTag}`,
        teamId: normalized,
      };
    };

    const inserts = changes
      .filter((change) => String(currentProfile[change.field_name] ?? '').trim() !== change.new_value.trim())
      .map((change) => ({
        user_id: user.id,
        requested_by: user.id,
        field_name: change.field_name,
        old_value: currentProfile?.[change.field_name] ?? null,
        new_value: change.new_value,
        status: 'pending',
      }));

    if (inserts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'Nenhuma alteração detectada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const autoApproveRoles = new Set(['admin', 'gerente_djt']);
    const canAutoApprove = (roleRows || []).some((r) => autoApproveRoles.has(r.role));

    if (canAutoApprove) {
      const updates: Record<string, any> = {};

      inserts.forEach((change) => {
        if (change.field_name === 'sigla_area') {
          updates.sigla_area = change.new_value;
          const org = deriveOrgUnits(change.new_value);
          if (org) {
            updates.division_id = org.divisionId;
            updates.coord_id = org.coordinationId;
            updates.team_id = org.teamId;
            updates.operational_base = change.new_value;
          }
        } else if (change.field_name === 'operational_base') {
          updates.operational_base = change.new_value;
          const org = deriveOrgUnits(currentProfile.sigla_area || change.new_value);
          if (org) {
            updates.division_id = org.divisionId;
            updates.coord_id = org.coordinationId;
            updates.team_id = org.teamId;
          }
        } else if (change.field_name === 'telefone') {
          updates.phone = change.new_value;
          updates.telefone = change.new_value;
        } else if (change.field_name === 'phone') {
          updates.phone = change.new_value;
          updates.telefone = change.new_value;
        } else {
          updates[change.field_name] = change.new_value;
        }
      });

      if (Object.keys(updates).length > 0) {
        const { error: profileUpdateError } = await (supabaseAdmin ?? supabaseClient)
          .from('profiles')
          .update(updates)
          .eq('id', user.id);
        if (profileUpdateError) throw profileUpdateError;

        if (supabaseAdmin) {
          if (typeof updates.name === 'string') {
            await supabaseAdmin.auth.admin.updateUserById(user.id, {
              user_metadata: { name: updates.name },
            });
          }
          if (typeof updates.email === 'string') {
            await supabaseAdmin.auth.admin.updateUserById(user.id, {
              email: updates.email,
              email_confirm: true,
            });
          }
        }
      }

      const now = new Date().toISOString();
      const approvedRecords = inserts.map((change) => ({
        user_id: user.id,
        requested_by: user.id,
        field_name: change.field_name,
        old_value: currentProfile?.[change.field_name] ?? null,
        new_value: change.new_value,
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: now,
      }));

      const { error: insertApprovedError } = await supabaseClient
        .from('profile_change_requests')
        .insert(approvedRecords);
      if (insertApprovedError) throw insertApprovedError;

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Alterações aplicadas imediatamente',
          requires_approval: false,
          count: inserts.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: insertError } = await supabaseClient
      .from('profile_change_requests')
      .insert(inserts);

    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Change request created successfully',
        requires_approval: true,
        count: inserts.length,
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
