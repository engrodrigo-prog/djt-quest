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

    const { post_id } = await req.json();

    // Verificar se já curtiu
    const { data: existingLike } = await supabase
      .from('forum_likes')
      .select('id')
      .eq('post_id', post_id)
      .eq('user_id', user.id)
      .single();

    if (existingLike) {
      // Remover curtida
      await supabase
        .from('forum_likes')
        .delete()
        .eq('id', existingLike.id);

      const { data: currentPost } = await supabase
        .from('forum_posts')
        .select('likes_count')
        .eq('id', post_id)
        .single();

      if (currentPost) {
        await supabase
          .from('forum_posts')
          .update({ likes_count: Math.max(0, currentPost.likes_count - 1) })
          .eq('id', post_id);
      }

      return new Response(
        JSON.stringify({ success: true, action: 'unliked' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Adicionar curtida
      await supabase
        .from('forum_likes')
        .insert({ post_id, user_id: user.id });

      // Buscar autor do post para notificar
      const { data: post } = await supabase
        .from('forum_posts')
        .select('author_id')
        .eq('id', post_id)
        .single();

      if (post && post.author_id !== user.id) {
        await supabase.rpc('create_notification', {
          _user_id: post.author_id,
          _type: 'forum_like',
          _title: '👍 Curtida recebida',
          _message: 'Alguém curtiu sua resposta no fórum',
          _metadata: { post_id }
        });
      }

      return new Response(
        JSON.stringify({ success: true, action: 'liked' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error in toggle-post-like:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});