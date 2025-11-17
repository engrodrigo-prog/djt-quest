import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupRequest {
  emailsToKeep?: string[];
  emailsToDelete?: string[];
  deleteAll?: boolean;
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
          persistSession: false,
        },
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

    const allowedRoles = new Set(['gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx', 'admin']);
    const hasPermission = roles?.some(({ role }) => allowedRoles.has(role));
    if (!hasPermission) {
      throw new Error('Insufficient permissions');
    }

    const { emailsToKeep = [], emailsToDelete = [], deleteAll } = await req.json() as CleanupRequest;

    console.log('=== CLEANUP STARTED ===');
    console.log('Emails to keep:', emailsToKeep.length);

    // Normalizar
    const normalizedKeep = emailsToKeep.map(e => e.trim().toLowerCase());
    const normalizedDelete = emailsToDelete.map(e => e.trim().toLowerCase());

    const results = {
      kept: [] as string[],
      deleted: [] as string[],
      errors: [] as { email: string; error: string }[],
    };

    // Primeiro, buscar todos os profiles
    const { data: allProfiles, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('id, email');

    if (fetchError) {
      console.error('Error fetching profiles:', fetchError);
      throw fetchError;
    }

    console.log('Total profiles found:', allProfiles.length);

    let idsParaDeletar: string[] = [];
    let emailsParaDeletar: (string | null)[] = [];

    if (deleteAll) {
      idsParaDeletar = allProfiles.map(p => p.id);
      emailsParaDeletar = allProfiles.map(p => p.email);
    } else if (normalizedDelete.length > 0) {
      const toDelete = allProfiles.filter(p => normalizedDelete.includes((p.email || '').toLowerCase().trim()))
      idsParaDeletar = toDelete.map(p => p.id);
      emailsParaDeletar = toDelete.map(p => p.email);
    } else {
      // Deletar todos que NÃO estão na lista de manter
      const toDelete = allProfiles.filter(p => !normalizedKeep.includes((p.email || '').toLowerCase().trim()));
      idsParaDeletar = toDelete.map(p => p.id);
      emailsParaDeletar = toDelete.map(p => p.email);
    }

    console.log('Profiles to DELETE:', idsParaDeletar.length);

    // Deletar user_roles e profiles usando .in() com arrays
    if (idsParaDeletar.length > 0) {
      try {
        // Deletar user_roles
        const { error: rolesError } = await supabaseAdmin
          .from('user_roles')
          .delete()
          .in('user_id', idsParaDeletar);

        if (rolesError) {
          console.error('Error deleting user_roles:', rolesError);
        } else {
          console.log(`Deleted user_roles for ${idsParaDeletar.length} users`);
        }

        // Deletar profiles
        const { data: deletedProfiles, error: profilesError } = await supabaseAdmin
          .from('profiles')
          .delete()
          .in('id', idsParaDeletar)
          .select('email');

        if (profilesError) {
          console.error('Error deleting profiles:', profilesError);
        } else if (deletedProfiles) {
          console.log(`Deleted ${deletedProfiles.length} profiles from database`);
          results.deleted.push(...deletedProfiles.map(p => p.email || 'unknown'));
        }
      } catch (error) {
        console.error('Error cleaning up database:', error);
      }
    } else {
      console.log('✅ No profiles to delete (all match keep list)');
    }

    console.log('=== Database cleanup complete ===');
    console.log('Total deleted from DB:', results.deleted.length);

    // Agora buscar todos os usuários auth
    console.log('=== Starting auth cleanup ===');
    const { data: allUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) throw listError;

    console.log('Total auth users found:', allUsers.users.length);

    // Deletar usuários auth que não estão na lista
    let authDeletedCount = 0;
    const isKept = (email: string | undefined | null) => {
      const em = (email || '').toLowerCase();
      if (deleteAll) return false;
      if (normalizedDelete.length > 0) {
        // Em modo de exclusão explícita, mantemos todos que NÃO estão na lista de deleção
        return !normalizedDelete.includes(em);
      }
      // Modo manter lista: mantém apenas emails explicitamente listados
      return normalizedKeep.includes(em);
    };

    for (const authUser of allUsers.users) {
      const userEmail = authUser.email?.toLowerCase();
      
      if (!userEmail || isKept(userEmail)) {
        results.kept.push(userEmail || 'unknown');
        continue;
      }

      try {
        // Deletar usuário via auth
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
        
        if (deleteError) throw deleteError;
        
        authDeletedCount++;
        if (!results.deleted.includes(userEmail)) {
          results.deleted.push(userEmail);
        }
      } catch (error) {
        console.error(`Error deleting user ${userEmail}:`, error);
        results.errors.push({
          email: userEmail,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    console.log('=== Auth cleanup complete ===');
    console.log('Auth users deleted:', authDeletedCount);
    console.log('=== CLEANUP FINISHED ===');
    console.log('Final results:', {
      totalDeleted: results.deleted.length,
      totalKept: results.kept.length,
      totalErrors: results.errors.length
    });

    return new Response(
      JSON.stringify({
        ...results,
        summary: {
          profilesDeleted: idsParaDeletar.length,
          authUsersDeleted: authDeletedCount,
          totalKept: results.kept.length,
          totalDeleted: results.deleted.length,
          errors: results.errors.length
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in studio-cleanup-users:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
