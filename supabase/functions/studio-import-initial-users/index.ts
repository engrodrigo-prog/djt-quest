import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UserRow {
  nome: string;
  matricula: string;
  email: string;
  telefone: string;
  cargo: string;
  sigla_area: string;
  base_operacional: string;
}

const cargoToRole: Record<string, string> = {
  'Gerente II': 'gerente_djt',
  'Gerente I': 'gerente_divisao_djtx',
  'Coordenação': 'coordenador_djtx',
};

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

    const { users } = await req.json();

    if (!users || !Array.isArray(users)) {
      throw new Error('Invalid users data');
    }

    const results = {
      success: [] as string[],
      errors: [] as { name: string; error: string }[],
      admins: [] as string[],
    };

    for (const userData of users as UserRow[]) {
      try {
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: userData.email.trim().toLowerCase(),
          password: '123456',
          email_confirm: true,
          user_metadata: {
            name: userData.nome.trim(),
          },
        });

        if (authError) throw authError;
        if (!authUser.user) throw new Error('Failed to create auth user');

        const role = cargoToRole[userData.cargo] || 'colaborador';
        const isAdminUser = userData.nome.toLowerCase().includes('rodrigo') || 
                           userData.nome.toLowerCase().includes('cintia');

        // Atualizar profile
        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .update({
            matricula: userData.matricula.trim(),
            operational_base: userData.base_operacional.trim(),
            sigla_area: userData.sigla_area.trim(),
            must_change_password: true,
            needs_profile_completion: !userData.telefone || userData.telefone.trim() === '',
          })
          .eq('id', authUser.user.id);

        if (profileError) throw profileError;

        // Inserir role
        const { error: roleError } = await supabaseAdmin
          .from('user_roles')
          .insert({
            user_id: authUser.user.id,
            role: role,
          });

        if (roleError) throw roleError;

        // Se for admin, adicionar role admin também
        if (isAdminUser) {
          await supabaseAdmin
            .from('user_roles')
            .insert({
              user_id: authUser.user.id,
              role: 'admin',
            });
          results.admins.push(userData.nome);
        }

        results.success.push(userData.nome);
      } catch (error) {
        console.error(`Error importing user ${userData.nome}:`, error);
        results.errors.push({
          name: userData.nome,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in studio-import-initial-users:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
