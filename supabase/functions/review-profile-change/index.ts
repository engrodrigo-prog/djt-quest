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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { request_id, action, review_notes } = await req.json();

    if (!request_id || !action || !['approved', 'rejected'].includes(action)) {
      throw new Error('Invalid request_id or action');
    }

    // Verificar se usuário é líder
    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isLeader = roles?.some(r => 
      ['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx'].includes(r.role)
    );

    if (!isLeader) {
      throw new Error('Unauthorized: Leader access required');
    }

    // Buscar solicitação
    const { data: request, error: fetchError } = await supabaseClient
      .from('profile_change_requests')
      .select('*')
      .eq('id', request_id)
      .eq('status', 'pending')
      .single();

    if (fetchError || !request) {
      throw new Error('Request not found or already processed');
    }

    // Atualizar status da solicitação
    const { error: updateRequestError } = await supabaseClient
      .from('profile_change_requests')
      .update({
        status: action,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: review_notes || null,
      })
      .eq('id', request_id);

    if (updateRequestError) throw updateRequestError;

    // Se aprovado, atualizar perfil
    const deriveOrg = (value: string) => {
      if (!value) return null;
      const normalized = value
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (!normalized) return null;
      const parts = normalized.split('-').filter(Boolean);
      const divisionId = parts[0] || 'DJT';
      const coordTag = parts[1] || 'SEDE';
      const teamId = normalized;
      return {
        divisionId: divisionId,
        coordinationId: `${divisionId}-${coordTag}`,
        teamId,
      };
    };

    if (action === 'approved') {
      const updates: Record<string, any> = { [request.field_name]: request.new_value };

      if (request.field_name === 'sigla_area') {
        const org = deriveOrg(request.new_value);
        if (org) {
          updates.division_id = org.divisionId;
          updates.coord_id = org.coordinationId;
          updates.team_id = org.teamId;
          updates.operational_base = request.new_value;
        }
      }

      if (request.field_name === 'operational_base') {
        const { data: profileRow } = await supabaseClient
          .from('profiles')
          .select('sigla_area')
          .eq('id', request.user_id)
          .single();
        const org = deriveOrg(profileRow?.sigla_area || request.new_value);
        if (org) {
          updates.division_id = org.divisionId;
          updates.coord_id = org.coordinationId;
          updates.team_id = org.teamId;
        }
      }

      const { error: updateProfileError } = await supabaseClient
        .from('profiles')
        .update(updates)
        .eq('id', request.user_id);

      if (updateProfileError) throw updateProfileError;

      if (request.field_name === 'name') {
        await supabaseAdmin.auth.admin.updateUserById(request.user_id, {
          user_metadata: { name: request.new_value },
        });
      }

      if (request.field_name === 'email') {
        await supabaseAdmin.auth.admin.updateUserById(request.user_id, {
          email: request.new_value,
          email_confirm: true,
        });
      }

      // Notificar usuário
      await supabaseClient.rpc('create_notification', {
        p_user_id: request.user_id,
        p_type: 'profile_change_approved',
        p_title: 'Alteração Aprovada',
        p_message: `Sua solicitação de alteração de ${request.field_name} foi aprovada.`,
        p_metadata: { request_id, field_name: request.field_name, new_value: request.new_value },
      });
    } else {
      // Notificar rejeição
      await supabaseClient.rpc('create_notification', {
        p_user_id: request.user_id,
        p_type: 'profile_change_rejected',
        p_title: 'Alteração Rejeitada',
        p_message: `Sua solicitação de alteração de ${request.field_name} foi rejeitada.`,
        p_metadata: { request_id, field_name: request.field_name, review_notes },
      });
    }

    return new Response(
      JSON.stringify({ success: true, action }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in review-profile-change:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
