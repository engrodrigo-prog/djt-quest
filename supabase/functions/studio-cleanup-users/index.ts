import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupRequest {
  emailsToKeep?: string[];
  emailsToDelete?: string[];
  idsToKeep?: string[];
  idsToDelete?: string[];
  deleteAll?: boolean;
}

const uniq = (arr: string[]) => Array.from(new Set(arr));

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

    const {
      emailsToKeep = [],
      emailsToDelete = [],
      idsToKeep = [],
      idsToDelete = [],
      deleteAll
    } = await req.json() as CleanupRequest;

    console.log('=== CLEANUP STARTED ===');
    console.log('Raw body:', { emailsToKeep, emailsToDelete, idsToKeep, idsToDelete, deleteAll });

    // Normalizar entradas
    const normalizedKeepEmails = emailsToKeep.map((e) => e.trim().toLowerCase());
    const normalizedDeleteEmails = emailsToDelete.map((e) => e.trim().toLowerCase());
    const normalizedKeepIds = idsToKeep.map((id) => id.trim());
    const normalizedDeleteIds = idsToDelete.map((id) => id.trim());

    const deleteAllFlag = Boolean(deleteAll);
    const hasExplicitDeletes = normalizedDeleteIds.length > 0 || normalizedDeleteEmails.length > 0;
    const hasKeeps = normalizedKeepIds.length > 0 || normalizedKeepEmails.length > 0;

    if (!deleteAllFlag && !hasExplicitDeletes && !hasKeeps) {
      console.log('Nenhum critério de limpeza informado, abortando para segurança');
      return new Response(
        JSON.stringify({
          kept: [],
          deleted: [],
          errors: [],
          summary: {
            profilesDeleted: 0,
            authUsersDeleted: 0,
            totalKept: 0,
            totalDeleted: 0,
            errors: 0,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results = {
      kept: [] as string[],
      deleted: [] as string[],
      errors: [] as { email: string; error: string }[],
    };

    // Carregar todos os perfis uma vez
    const { data: allProfiles, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('id, email');

    if (fetchError) {
      console.error('Error fetching profiles:', fetchError);
      throw fetchError;
    }

    console.log('Total profiles found:', allProfiles.length);

    // Determinar quais profiles devem ser deletados
    let profilesToDelete: { id: string; email: string | null }[] = [];

    if (deleteAllFlag) {
      profilesToDelete = allProfiles;
    } else if (hasExplicitDeletes) {
      profilesToDelete = allProfiles.filter((p) => {
        const emailNorm = (p.email || '').toLowerCase().trim();
        return normalizedDeleteIds.includes(p.id) || normalizedDeleteEmails.includes(emailNorm);
      });
    } else if (hasKeeps) {
      profilesToDelete = allProfiles.filter((p) => {
        const emailNorm = (p.email || '').toLowerCase().trim();
        const keepId = normalizedKeepIds.includes(p.id);
        const keepEmail = normalizedKeepEmails.includes(emailNorm);
        return !(keepId || keepEmail);
      });
    }

    const idsParaDeletar = profilesToDelete.map((p) => p.id);
    const emailsParaDeletar = profilesToDelete.map((p) => p.email);

    console.log('Profiles to DELETE (matched in DB):', {
      count: idsParaDeletar.length,
      ids: idsParaDeletar,
      emails: emailsParaDeletar,
    });

    // Antes de deletar perfis, cancelar eventos desses usuários para não violar
    // a regra de participantes mínimos (trigger enforce_participants_count).
    if (idsParaDeletar.length > 0) {
      try {
        const { error: eventsError } = await supabaseAdmin
          .from('events')
          .update({ status: 'cancelled' })
          .in('user_id', idsParaDeletar);
        if (eventsError) {
          console.error('Error cancelling events before cleanup:', eventsError);
        } else {
          console.log('Marked events as cancelled for users:', idsParaDeletar.length);
        }
      } catch (evErr) {
        console.error('Unexpected error cancelling events before cleanup:', evErr);
      }
    }

    // Limpar user_roles + profiles (redundante com cascade pelo auth, mas garante remoção de órfãos)
    if (idsParaDeletar.length > 0) {
      try {
        const { error: rolesError } = await supabaseAdmin
          .from('user_roles')
          .delete()
          .in('user_id', idsParaDeletar);

        if (rolesError) {
          console.error('Error deleting user_roles:', rolesError);
        } else {
          console.log(`Deleted user_roles for ${idsParaDeletar.length} users`);
        }

        const { data: deletedProfiles, error: profilesError } = await supabaseAdmin
          .from('profiles')
          .delete()
          .in('id', idsParaDeletar)
          .select('email');

        if (profilesError) {
          console.error('Error deleting profiles:', profilesError);
        } else if (deletedProfiles) {
          console.log(`Deleted ${deletedProfiles.length} profiles from database`);
          results.deleted.push(...deletedProfiles.map((p) => p.email || 'unknown'));
        }
      } catch (dbError) {
        console.error('Error cleaning up database:', dbError);
      }
    } else {
      console.log('Nenhum profile encontrado para deletar (verifique filtros / listas)');
    }

    console.log('=== Database cleanup complete ===');
    console.log('Total deleted from DB:', results.deleted.length);

    // Agora limpar auth.users
    console.log('=== Starting auth cleanup ===');
    const { data: allUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    if (listError) throw listError;

    console.log('Total auth users found:', allUsers.users.length);

    // Conjuntos para auth: sempre incluir valores vindos da requisição, mesmo que não tenham profile
    const idsToDeleteSet = new Set<string>([
      ...idsParaDeletar,
      ...normalizedDeleteIds,
    ]);
    const emailsToDeleteSet = new Set<string>([
      ...emailsParaDeletar.map((e) => (e || '').toLowerCase()),
      ...normalizedDeleteEmails,
    ]);
    const keepIdsSet = new Set<string>(normalizedKeepIds);
    const keepEmailsSet = new Set<string>(normalizedKeepEmails);

    const shouldDeleteAuth = (authUserId: string | undefined, email: string | undefined | null) => {
      const em = (email || '').toLowerCase();

      if (deleteAllFlag) {
        if (keepIdsSet.size === 0 && keepEmailsSet.size === 0) return true;
        const keep = (authUserId && keepIdsSet.has(authUserId)) || keepEmailsSet.has(em);
        return !keep;
      }

      if (idsToDeleteSet.size > 0 || emailsToDeleteSet.size > 0) {
        return (authUserId && idsToDeleteSet.has(authUserId)) || emailsToDeleteSet.has(em);
      }

      if (keepIdsSet.size > 0 || keepEmailsSet.size > 0) {
        const keep = (authUserId && keepIdsSet.has(authUserId)) || keepEmailsSet.has(em);
        return !keep;
      }

      return false;
    };

    let authDeletedCount = 0;

    for (const authUser of allUsers.users) {
      const userEmail = authUser.email?.toLowerCase();

      if (!shouldDeleteAuth(authUser.id, userEmail)) {
        results.kept.push(userEmail || 'unknown');
        continue;
      }

      try {
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
        if (deleteError) throw deleteError;
        authDeletedCount++;

        const identifier = userEmail || authUser.id;
        if (!results.deleted.includes(identifier)) {
          results.deleted.push(identifier);
        }
      } catch (authError) {
        console.error(`Error deleting auth user ${userEmail || authUser.id}:`, authError);
        results.errors.push({
          email: userEmail || authUser.id,
          error: authError instanceof Error ? authError.message : 'Unknown error',
        });
      }
    }

    console.log('=== Auth cleanup complete ===');
    console.log('Auth users deleted:', authDeletedCount);

    // Remover entradas do histórico de cadastro (pending_registrations) para usuários apagados.
    try {
      const cleanupEmails = uniq(
        [
          ...emailsParaDeletar,
          ...normalizedDeleteEmails,
          ...results.deleted,
        ]
          .map((e) => String(e || '').trim().toLowerCase())
          .filter((e) => e && e.includes('@')),
      );
      if (cleanupEmails.length > 0) {
        const { data: deletedCount, error: prErr } = await supabaseAdmin.rpc('delete_pending_registrations_by_emails', {
          p_emails: cleanupEmails,
        });
        if (prErr) console.error('Error deleting pending_registrations by email:', prErr);
        else console.log('Deleted pending_registrations rows:', Number(deletedCount || 0));
      }
    } catch (e) {
      console.error('Unexpected error cleaning pending_registrations:', e);
    }

    console.log('=== CLEANUP FINISHED ===');
    console.log('Final results:', {
      totalDeleted: results.deleted.length,
      totalKept: results.kept.length,
      totalErrors: results.errors.length,
    });

    return new Response(
      JSON.stringify({
        ...results,
        summary: {
          profilesDeleted: idsParaDeletar.length,
          authUsersDeleted: authDeletedCount,
          totalKept: results.kept.length,
          totalDeleted: results.deleted.length,
          errors: results.errors.length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Error in studio-cleanup-users:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
