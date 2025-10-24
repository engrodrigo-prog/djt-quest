import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestUser {
  email: string;
  password: string;
  name: string;
  role: 'colaborador' | 'coordenador_djtx' | 'lider_divisao_djtx' | 'gerente_djt';
  team_id?: string;
  coord_id?: string;
  division_id?: string;
  department_id?: string;
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
          persistSession: false
        }
      }
    );

    console.log('Starting seed-test-users...');

    // Buscar IDs da estrutura organizacional
    const { data: teams } = await supabaseAdmin
      .from('teams')
      .select('id, name');

    const { data: coords } = await supabaseAdmin
      .from('coordinations')
      .select('id, name');

    const { data: divisions } = await supabaseAdmin
      .from('divisions')
      .select('id, name');

    const { data: departments } = await supabaseAdmin
      .from('departments')
      .select('id, name');

    console.log('Found structure:', { teams: teams?.length, coords: coords?.length, divisions: divisions?.length, departments: departments?.length });

    // Mapear IDs
    const teamAlpha = teams?.find(t => t.name === 'Equipe Alpha');
    const coordABC = coords?.find(c => c.name === 'DJTX-ABC');
    const divDJTX = divisions?.find(d => d.name === 'DJTX - Divisão Executora');
    const deptDJT = departments?.find(d => d.name === 'DJT - Departamento de Segurança');

    // Definir usuários de teste
    const testUsers: TestUser[] = [
      {
        email: 'colab@teste.com',
        password: 'teste123',
        name: 'João Silva (Colaborador)',
        role: 'colaborador',
        team_id: teamAlpha?.id,
        coord_id: coordABC?.id,
        division_id: divDJTX?.id,
        department_id: deptDJT?.id
      },
      {
        email: 'coordenador@teste.com',
        password: 'teste123',
        name: 'Maria Santos (Coordenadora DJTX-ABC)',
        role: 'coordenador_djtx',
        coord_id: coordABC?.id,
        division_id: divDJTX?.id,
        department_id: deptDJT?.id
      },
      {
        email: 'lider@teste.com',
        password: 'teste123',
        name: 'Carlos Oliveira (Líder Divisão DJTX)',
        role: 'lider_divisao_djtx',
        division_id: divDJTX?.id,
        department_id: deptDJT?.id
      },
      {
        email: 'gerente@teste.com',
        password: 'teste123',
        name: 'Ana Paula (Gerente DJT)',
        role: 'gerente_djt',
        department_id: deptDJT?.id
      }
    ];

    const results = [];

    for (const user of testUsers) {
      // Verificar se já existe
      const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
      const userExists = existingUser?.users.find(u => u.email === user.email);

      if (userExists) {
        console.log(`User ${user.email} already exists, skipping...`);
        results.push({ email: user.email, status: 'already_exists' });
        continue;
      }

      // Criar usuário
      const { data: newUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { name: user.name }
      });

      if (authError || !newUser.user) {
        console.error(`Error creating ${user.email}:`, authError);
        results.push({ email: user.email, status: 'error', error: authError?.message });
        continue;
      }

      console.log(`Created auth user: ${newUser.user.id}`);

      // Criar profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: newUser.user.id,
          email: user.email,
          name: user.name,
          team_id: user.team_id || null,
          coord_id: user.coord_id || null,
          division_id: user.division_id || null,
          department_id: user.department_id || null,
          xp: 0,
          tier: 'EX-1',
          studio_access: ['coordenador_djtx', 'lider_divisao_djtx', 'gerente_djt'].includes(user.role)
        });

      if (profileError) {
        console.error(`Error creating profile for ${user.email}:`, profileError);
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
        results.push({ email: user.email, status: 'error', error: profileError.message });
        continue;
      }

      console.log(`Created profile for: ${newUser.user.id}`);

      // Atribuir role
      const { error: roleError } = await supabaseAdmin
        .from('user_roles')
        .insert({
          user_id: newUser.user.id,
          role: user.role
        });

      if (roleError) {
        console.error(`Error assigning role to ${user.email}:`, roleError);
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
        results.push({ email: user.email, status: 'error', error: roleError.message });
        continue;
      }

      console.log(`Assigned role ${user.role} to: ${newUser.user.id}`);

      results.push({ 
        email: user.email, 
        status: 'created',
        id: newUser.user.id,
        role: user.role
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Seed completed',
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in seed-test-users:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
