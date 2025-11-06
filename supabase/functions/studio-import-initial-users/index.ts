import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UserRow {
  nome: string;
  matricula: string;
  email: string;
  telefone?: string;
  cargo: string;
  sigla_area: string;
  base_operacional: string;
  date_of_birth?: string; // YYYY-MM-DD
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

    // Authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Unauthorized');
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Unauthorized');
    }
    const { data: roles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    const allowed = roles?.some(r => ['admin','gerente_djt','gerente_divisao_djtx','coordenador_djtx'].includes(r.role));
    if (!allowed) {
      throw new Error('Insufficient permissions');
    }

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
        const email = userData.email.trim().toLowerCase();
        const nome = userData.nome.trim();
        const matricula = userData.matricula.trim();
        const siglaArea = userData.sigla_area.trim();
        const baseOperacional = userData.base_operacional.trim();
        const telefone = (userData.telefone || '').trim();
        const dateOfBirth = (userData.date_of_birth || '').trim() || null;
        const role = cargoToRole[userData.cargo] || 'colaborador';
        const isAdminUser = userData.nome.toLowerCase().includes('rodrigo') || 
                           userData.nome.toLowerCase().includes('cintia');
        
        // Verificar se já existe profile por email
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, email')
          .eq('email', email)
          .maybeSingle();

        let userId: string | null = null;

        if (existingProfile?.id) {
          userId = existingProfile.id;

          // Atualizar auth user (nome e confirmar email). Opcionalmente resetar senha
          const { error: updateAuthErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            email,
            password: '123456',
            email_confirm: true,
            user_metadata: { name: nome },
          });
          if (updateAuthErr) {
            // Se falhar atualização de senha/email, logamos mas seguimos com DB
            console.warn('Auth update warning for', email, updateAuthErr.message);
          }

          // Atualizar profile com overwrite dos campos relevantes
          const { error: updProfileErr } = await supabaseAdmin
            .from('profiles')
            .update({
              name: nome,
              email,
              matricula,
              operational_base: baseOperacional,
              sigla_area: siglaArea,
              must_change_password: true,
              needs_profile_completion: false,
              is_leader: ['coordenador_djtx','gerente_divisao_djtx','gerente_djt'].includes(role),
              studio_access: ['coordenador_djtx','gerente_divisao_djtx','gerente_djt'].includes(role),
              date_of_birth: dateOfBirth,
            })
            .eq('id', userId);
          if (updProfileErr) throw updProfileErr;
        } else {
          // Criar novo auth user
          const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: '123456',
            email_confirm: true,
            user_metadata: { name: nome },
          });
          if (authError) throw authError;
          if (!authUser.user) throw new Error('Failed to create auth user');
          userId = authUser.user.id;

          // Atualizar profile
          const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update({
              name: nome,
              email,
              matricula,
              operational_base: baseOperacional,
              sigla_area: siglaArea,
              must_change_password: true,
              needs_profile_completion: false,
              is_leader: ['coordenador_djtx','gerente_divisao_djtx','gerente_djt'].includes(role),
              studio_access: ['coordenador_djtx','gerente_divisao_djtx','gerente_djt'].includes(role),
              date_of_birth: dateOfBirth,
            })
            .eq('id', userId);
          if (profileError) throw profileError;
        }

        // Garantir role principal via upsert
        const { error: roleUpsertError } = await supabaseAdmin
          .from('user_roles')
          .upsert({ user_id: userId!, role }, { onConflict: 'user_id,role' });
        if (roleUpsertError) throw roleUpsertError;

        if (isAdminUser) {
          await supabaseAdmin
            .from('user_roles')
            .upsert({ user_id: userId!, role: 'admin' }, { onConflict: 'user_id,role' });
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
