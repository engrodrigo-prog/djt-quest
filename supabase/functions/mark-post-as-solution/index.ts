import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Unauthorized');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Verificar se é líder
    const { data: profile } = await supabase
      .from('profiles')
      .select('studio_access, is_leader')
      .eq('id', user.id)
      .single();

    if (!profile?.studio_access || !profile.is_leader) {
      throw new Error('Only leaders can mark solutions');
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const allowedRoles = new Set([
      'coordenador_djtx',
      'gerente_divisao_djtx',
      'gerente_djt',
      'admin',
    ]);

    const hasAllowedRole = roles?.some(({ role }) => allowedRoles.has(role));
    if (!hasAllowedRole) {
      throw new Error('Insufficient permissions to mark solutions');
    }

    const { post_id } = await req.json();

    // Buscar post
    const { data: post, error: postError } = await supabase
      .from('forum_posts')
      .select('topic_id, author_id')
      .eq('id', post_id)
      .single();

    if (postError || !post) {
      throw new Error('Post not found');
    }

    if (post.author_id === user.id) {
      throw new Error('You cannot mark your own post as a solution');
    }

    // Desmarcar solução anterior
    await supabase
      .from('forum_posts')
      .update({ is_solution: false })
      .eq('topic_id', post.topic_id)
      .eq('is_solution', true);

    // Marcar como solução
    const { error: updateError } = await supabase
      .from('forum_posts')
      .update({ is_solution: true })
      .eq('id', post_id);

    if (updateError) {
      throw new Error('Failed to mark as solution');
    }

    // Conceder XP bônus ao autor (+20 XP)
    const { error: xpError } = await supabase.rpc('increment_user_xp', {
      _user_id: post.author_id,
      _xp_to_add: 20,
    });

    if (xpError) {
      console.error('Error awarding XP bonus:', xpError);
      throw new Error('Failed to award XP bonus');
    }

    // Notificar autor
    await supabase.rpc('create_notification', {
      _user_id: post.author_id,
      _type: 'forum_solution',
      _title: '✅ Resposta marcada como solução!',
      _message: 'Sua resposta foi marcada como solução oficial (+20 XP)',
      _metadata: { post_id, bonus_xp: 20 }
    });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in mark-post-as-solution:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
