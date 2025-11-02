import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Nomes brasileiros realistas
const firstNames = [
  'João', 'Maria', 'José', 'Ana', 'Pedro', 'Carla', 'Lucas', 'Juliana', 'Carlos', 'Fernanda',
  'Rafael', 'Beatriz', 'Felipe', 'Camila', 'Bruno', 'Mariana', 'Gabriel', 'Patricia', 'Rodrigo', 'Amanda',
  'Thiago', 'Larissa', 'Diego', 'Natália', 'Gustavo', 'Renata', 'Leonardo', 'Débora', 'Marcelo', 'Vanessa',
  'André', 'Tatiana', 'Paulo', 'Luciana', 'Ricardo', 'Sandra', 'Vinícius', 'Cristina', 'Fernando', 'Silvia',
  'Mateus', 'Adriana', 'Alexandre', 'Daniela', 'Igor', 'Michele', 'Daniel', 'Fabiana', 'Fábio', 'Roberta',
  'Leandro', 'Aline', 'Márcio', 'Priscila', 'Guilherme', 'Jéssica', 'Roberto', 'Viviane', 'Sérgio', 'Elaine',
  'Renato', 'Simone', 'Cesar', 'Kelly', 'Anderson', 'Bianca', 'Marcos', 'Letícia', 'Henrique', 'Carolina',
  'Eduardo', 'Bruna', 'William', 'Sabrina', 'Caio', 'Mônica', 'Jorge', 'Raquel', 'Francisco', 'Andréa'
];

const lastNames = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes',
  'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Rocha', 'Almeida', 'Nascimento', 'Araújo', 'Melo', 'Barbosa',
  'Cardoso', 'Correia', 'Dias', 'Teixeira', 'Lopes', 'Mendes', 'Monteiro', 'Castro', 'Moreira', 'Pinto',
  'Fernandes', 'Freitas', 'Machado', 'Campos', 'Ramos', 'Cavalcanti', 'Gonçalves', 'Barros', 'Moura', 'Nunes'
];

function generateName() {
  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${first} ${last}`;
}

function generateEmail(name: string, index: number) {
  return `${name.toLowerCase().replace(/ /g, '.')}.${index}@djtquest.com.br`;
}

function generateXP(tier: string): number {
  const prefix = tier.split('-')[0] as 'EX' | 'FO' | 'GU';
  const level = parseInt(tier.split('-')[1]);
  
  const ranges: Record<'EX' | 'FO' | 'GU', number[][]> = {
    'EX': [
      [100, 299], [300, 699], [700, 1199], [1200, 1799], [1800, 2000]
    ],
    'FO': [
      [400, 899], [900, 1499], [1500, 2199], [2200, 2500], [2500, 2700]
    ],
    'GU': [
      [500, 1099], [1100, 1799], [1800, 2599], [2600, 3000], [3000, 3500]
    ]
  };
  
  const range = ranges[prefix][level - 1];
  return Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Unauthorized');
    }

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

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { data: roles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const allowedRoles = new Set(['gerente_djt', 'admin']);
    const hasPermission = roles?.some(({ role }) => allowedRoles.has(role));
    if (!hasPermission) {
      throw new Error('Insufficient permissions');
    }

    console.log('Starting seed-production-data for user:', user.id);

    // Buscar estrutura organizacional
    const { data: department } = await supabaseAdmin
      .from('departments')
      .select('id, name')
      .limit(1)
      .single();

    const { data: divisions } = await supabaseAdmin
      .from('divisions')
      .select('id, name')
      .order('name');

    const { data: coordinations } = await supabaseAdmin
      .from('coordinations')
      .select('id, name, division_id')
      .order('name');

    const { data: teams } = await supabaseAdmin
      .from('teams')
      .select('id, name, coordination_id')
      .order('name');

    console.log('Organizational structure loaded:', {
      department: department?.name,
      divisions: divisions?.length,
      coordinations: coordinations?.length,
      teams: teams?.length
    });

    const users = [];
    const usedNames = new Set();
    let userIndex = 1;

    // Helper para gerar nome único
    const getUniqueName = () => {
      let name = generateName();
      while (usedNames.has(name)) {
        name = generateName();
      }
      usedNames.add(name);
      return name;
    };

    // 1. Gerente Geral DJT
    const gerenteGeralName = getUniqueName();
    users.push({
      email: generateEmail(gerenteGeralName, userIndex++),
      password: 'senha123',
      name: `${gerenteGeralName} (Gerente Geral DJT)`,
      role: 'gerente_djt' as const,
      department_id: department?.id,
      xp: 3500,
      tier: 'GU-5'
    });

    // 2. Gerentes de Divisão (1 por divisão)
    for (const division of divisions || []) {
      const name = getUniqueName();
      users.push({
        email: generateEmail(name, userIndex++),
        password: 'senha123',
        name: `${name} (Gerente ${division.name})`,
        role: 'gerente_divisao_djtx' as const,
        division_id: division.id,
        department_id: department?.id,
        xp: 3200,
        tier: 'GU-4'
      });
    }

    // 3. Coordenadores (1 por coordenação)
    for (const coord of coordinations || []) {
      const name = getUniqueName();
      const division = divisions?.find(d => d.id === coord.division_id);
      users.push({
        email: generateEmail(name, userIndex++),
        password: 'senha123',
        name: `${name} (Coordenador ${coord.name})`,
        role: 'coordenador_djtx' as const,
        coord_id: coord.id,
        division_id: coord.division_id,
        department_id: department?.id,
        xp: 2800,
        tier: 'FO-5'
      });
    }

    // 4. Colaboradores (distribuídos nos times)
    const teamDistribution = [
      { count: 10, team: teams?.[0] }, // DJTB CUB
      { count: 9, team: teams?.[1] },  // DJTB STO
      { count: 9, team: teams?.[2] },  // DJTV ITP
      { count: 8, team: teams?.[3] },  // DJTV JUN
      { count: 10, team: teams?.[4] }, // DJTV PJU
      { count: 8, team: teams?.[5] },  // DJTV VOT
      { count: 8, team: teams?.[6] }   // DJTX ABC (novo)
    ];

    // Distribuição de tiers para colaboradores
    const tierDistribution = [
      // 40% EX (25 pessoas)
      ...Array(5).fill('EX-1'),
      ...Array(5).fill('EX-2'),
      ...Array(6).fill('EX-3'),
      ...Array(5).fill('EX-4'),
      ...Array(4).fill('EX-5'),
      // 35% FO (22 pessoas)
      ...Array(4).fill('FO-1'),
      ...Array(5).fill('FO-2'),
      ...Array(6).fill('FO-3'),
      ...Array(4).fill('FO-4'),
      ...Array(3).fill('FO-5'),
      // 25% GU (15 pessoas)
      ...Array(3).fill('GU-1'),
      ...Array(4).fill('GU-2'),
      ...Array(4).fill('GU-3'),
      ...Array(2).fill('GU-4'),
      ...Array(2).fill('GU-5')
    ];

    // Shuffle tier distribution
    for (let i = tierDistribution.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tierDistribution[i], tierDistribution[j]] = [tierDistribution[j], tierDistribution[i]];
    }

    let tierIndex = 0;
    for (const { count, team } of teamDistribution) {
      if (!team) continue;
      
      const coord = coordinations?.find(c => c.id === team.coordination_id);
      const division = divisions?.find(d => d.id === coord?.division_id);

      for (let i = 0; i < count; i++) {
        const name = getUniqueName();
        const tier = tierDistribution[tierIndex++] || 'EX-1';
        const xp = generateXP(tier);

        users.push({
          email: generateEmail(name, userIndex++),
          password: 'senha123',
          name: `${name} (${team.name})`,
          role: 'colaborador' as const,
          team_id: team.id,
          coord_id: coord?.id,
          division_id: division?.id,
          department_id: department?.id,
          xp,
          tier
        });
      }
    }

    console.log(`Generated ${users.length} users`);

    const results = [];

    for (const user of users) {
      // Verificar se usuário já existe
      const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
      const found = existingUser?.users.find(u => u.email === user.email);

      if (found) {
        console.log(`User ${user.email} already exists, skipping...`);
        results.push({ email: user.email, status: 'exists', id: found.id });
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

      console.log(`Created auth user: ${newUser.user.id} - ${user.email}`);

      // Atualizar profile
      const isLeaderRole = ['coordenador_djtx', 'gerente_divisao_djtx', 'gerente_djt'].includes(user.role);
      
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({
          email: user.email,
          name: user.name,
          team_id: user.team_id || null,
          coord_id: user.coord_id || null,
          division_id: user.division_id || null,
          department_id: user.department_id || null,
          xp: user.xp,
          tier: user.tier,
          is_leader: isLeaderRole,
          studio_access: isLeaderRole
        })
        .eq('id', newUser.user.id);

      if (profileError) {
        console.error(`Error updating profile for ${user.email}:`, profileError);
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
        results.push({ email: user.email, status: 'error', error: profileError.message });
        continue;
      }

      // Atribuir role
      const { error: roleError } = await supabaseAdmin
        .from('user_roles')
        .upsert({ user_id: newUser.user.id, role: user.role }, { onConflict: 'user_id,role' });

      if (roleError) {
        console.error(`Error assigning role to ${user.email}:`, roleError);
        results.push({ email: user.email, status: 'error', error: roleError.message });
        continue;
      }

      console.log(`✓ Created ${user.email} - ${user.role} - Tier: ${user.tier} (${user.xp} XP)`);
      results.push({ 
        email: user.email, 
        status: 'created',
        id: newUser.user.id,
        role: user.role,
        tier: user.tier,
        xp: user.xp
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Seed completed - ${users.length} users processed`,
        results,
        summary: {
          total: users.length,
          gerente_djt: users.filter(u => u.role === 'gerente_djt').length,
          gerente_divisao_djtx: users.filter(u => u.role === 'gerente_divisao_djtx').length,
          coordenador_djtx: users.filter(u => u.role === 'coordenador_djtx').length,
          colaborador: users.filter(u => u.role === 'colaborador').length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in seed-production-data:', error);
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
