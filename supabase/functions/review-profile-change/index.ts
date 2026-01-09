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

    // Buscar roles (usar service role para evitar RLS/visibilidade limitada)
    const { data: roles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const normalizeRole = (r: string) => {
      const raw = String(r || '').trim().toLowerCase();
      if (!raw) return '';
      if (raw === 'gerente') return 'gerente_djt';
      if (raw === 'lider_divisao') return 'gerente_divisao_djtx';
      if (raw === 'coordenador') return 'coordenador_djtx';
      return raw;
    };
    const reviewerRoles = (roles?.map((r) => normalizeRole(r.role)) ?? []).filter(Boolean);

    // Buscar solicitação (service role: RLS pode bloquear revisores não-admin)
    const { data: request, error: fetchError } = await supabaseAdmin
      .from('profile_change_requests')
      .select('*')
      .eq('id', request_id)
      .eq('status', 'pending')
      .single();

    if (fetchError || !request) {
      throw new Error('Request not found or already processed');
    }

    if (!request.field_name) {
      throw new Error('Invalid request');
    }

    const { data: reviewerProfile } = await supabaseAdmin
      .from('profiles')
      .select('division_id, coord_id, team_id, sigla_area, operational_base, is_leader')
      .eq('id', user.id)
      .single();

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('division_id, coord_id, team_id, sigla_area, operational_base')
      .eq('id', request.user_id)
      .single();

    const normalizeTeamKey = (value: string | null | undefined) =>
      String(value || '').trim().toUpperCase().replace(/\s+/g, '-');

    const canReview = () => {
      if (reviewerRoles.includes('admin') || reviewerRoles.includes('gerente_djt')) return true;
      if (reviewerRoles.includes('gerente_divisao_djtx')) {
        return reviewerProfile?.division_id && reviewerProfile.division_id === targetProfile?.division_id;
      }
      if (reviewerRoles.includes('coordenador_djtx')) {
        return reviewerProfile?.coord_id && reviewerProfile.coord_id === targetProfile?.coord_id;
      }
      // Líder de equipe: pode revisar apenas do próprio time (ou se estiver marcado como líder no perfil).
      if (reviewerRoles.includes('lider_equipe') || reviewerProfile?.is_leader) {
        const reviewerTeam = normalizeTeamKey(
          reviewerProfile?.team_id || reviewerProfile?.sigla_area || reviewerProfile?.operational_base,
        );
        const targetTeam = normalizeTeamKey(
          targetProfile?.team_id || targetProfile?.sigla_area || targetProfile?.operational_base,
        );
        return !!reviewerTeam && reviewerTeam === targetTeam;
      }
      return false;
    };

    if (!canReview()) {
      throw new Error('Sem permissão para aprovar alterações deste colaborador');
    }

    // Atualizar status da solicitação
    const { error: updateRequestError } = await supabaseAdmin
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
      const org = deriveOrg(targetProfile?.sigla_area || request.new_value);
        if (org) {
          updates.division_id = org.divisionId;
          updates.coord_id = org.coordinationId;
          updates.team_id = org.teamId;
        }
      }

      const { error: updateProfileError } = await supabaseAdmin
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
        _user_id: request.user_id,
        _type: 'profile_change_approved',
        _title: 'Alteração Aprovada',
        _message: `Sua solicitação de alteração de ${request.field_name} foi aprovada.`,
        _metadata: { request_id, field_name: request.field_name, new_value: request.new_value },
      });
    } else {
      // Notificar rejeição
      await supabaseClient.rpc('create_notification', {
        _user_id: request.user_id,
        _type: 'profile_change_rejected',
        _title: 'Alteração Rejeitada',
        _message: `Sua solicitação de alteração de ${request.field_name} foi rejeitada.`,
        _metadata: { request_id, field_name: request.field_name, review_notes },
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
