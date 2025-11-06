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

    const allowedFields = new Set(['name', 'email', 'operational_base', 'sigla_area', 'date_of_birth', 'telefone', 'matricula']);
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

    const { data: currentProfile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!currentProfile) {
      throw new Error('Perfil não encontrado');
    }

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
