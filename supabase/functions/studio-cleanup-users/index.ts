import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupRequest {
  emailsToKeep: string[];
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
          persistSession: false,
        },
      }
    );

    const { emailsToKeep } = await req.json() as CleanupRequest;

    if (!emailsToKeep || !Array.isArray(emailsToKeep) || emailsToKeep.length === 0) {
      throw new Error('Invalid emails list');
    }

    // Normalizar emails para comparação
    const normalizedEmails = emailsToKeep.map(e => e.trim().toLowerCase());

    // Buscar todos os usuários
    const { data: allUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) throw listError;

    const results = {
      kept: [] as string[],
      deleted: [] as string[],
      errors: [] as { email: string; error: string }[],
    };

    // Deletar usuários que não estão na lista
    for (const authUser of allUsers.users) {
      const userEmail = authUser.email?.toLowerCase();
      
      if (!userEmail || normalizedEmails.includes(userEmail)) {
        results.kept.push(userEmail || 'unknown');
        continue;
      }

      try {
        // Deletar usuário via auth (cascade vai deletar profile e roles)
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
        
        if (deleteError) throw deleteError;
        
        results.deleted.push(userEmail);
      } catch (error) {
        console.error(`Error deleting user ${userEmail}:`, error);
        results.errors.push({
          email: userEmail,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return new Response(
      JSON.stringify(results),
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
