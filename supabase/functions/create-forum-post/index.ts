import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PostRequest {
  topic_id: string;
  content: string;
  parent_post_id?: string;
  attachment_urls?: string[];
}

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

    const { topic_id, content, parent_post_id, attachment_urls }: PostRequest = await req.json();

    // Validar tópico
    const { data: topic, error: topicError } = await supabase
      .from('forum_topics')
      .select('is_active, is_locked')
      .eq('id', topic_id)
      .single();

    if (topicError || !topic) {
      throw new Error('Topic not found');
    }

    if (!topic.is_active || topic.is_locked) {
      throw new Error('Topic is closed or locked');
    }

    // Extrair @menções (formato: @nome ou @nome.sobrenome)
    const mentionRegex = /@([a-zA-ZÀ-ÿ]+(?:\.[a-zA-ZÀ-ÿ]+)?)/g;
    const mentions = [...content.matchAll(mentionRegex)].map(m => m[1]);

    // Buscar IDs dos usuários mencionados
    const mentionedUsers = [];
    if (mentions.length > 0) {
      const { data: users } = await supabase
        .from('profiles')
        .select('id, name')
        .ilike('name', `%${mentions.join('%')}%`);
      
      if (users) mentionedUsers.push(...users);
    }

    // Extrair #hashtags
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
    const hashtags = [...new Set([...content.matchAll(hashtagRegex)].map(m => m[1].toLowerCase()))];

    // Criar/buscar hashtags
    const hashtagIds = [];
    for (const tag of hashtags) {
      const { data: existingTag } = await supabase
        .from('forum_hashtags')
        .select('id')
        .eq('tag', tag)
        .single();

      if (existingTag) {
        hashtagIds.push(existingTag.id);
      } else {
        const { data: newTag } = await supabase
          .from('forum_hashtags')
          .insert({ tag })
          .select('id')
          .single();
        
        if (newTag) hashtagIds.push(newTag.id);
      }
    }

    // Renderizar HTML com links
    let contentHtml = content
      .replace(mentionRegex, '<span class="text-primary font-semibold">@$1</span>')
      .replace(hashtagRegex, '<span class="text-accent font-semibold">#$1</span>');

    // Inserir post
    const { data: post, error: postError } = await supabase
      .from('forum_posts')
      .insert({
        topic_id,
        author_id: user.id,
        content,
        content_html: contentHtml,
        parent_post_id,
        attachment_urls
      })
      .select()
      .single();

    if (postError) {
      console.error('Error creating post:', postError);
      throw new Error('Failed to create post');
    }

    // Processar anexos e criar metadados
    if (attachment_urls && attachment_urls.length > 0) {
      for (const url of attachment_urls) {
        try {
          const storagePath = url.split('/forum-attachments/')[1];
          if (!storagePath) continue;

          // Detectar tipo de arquivo
          const ext = url.split('.').pop()?.toLowerCase() || '';
          let fileType = 'document';
          let mimeType = 'application/octet-stream';

          if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            fileType = 'image';
            mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          } else if (['mp3', 'wav', 'ogg', 'webm', 'm4a'].includes(ext)) {
            fileType = 'audio';
            mimeType = `audio/${ext}`;
          } else if (['mp4', 'webm', 'mov'].includes(ext)) {
            fileType = 'video';
            mimeType = `video/${ext === 'mov' ? 'quicktime' : ext}`;
          } else if (ext === 'pdf') {
            mimeType = 'application/pdf';
          }

          // Obter informações do arquivo do storage
          const { data: fileInfo } = await supabase.storage
            .from('forum-attachments')
            .list(storagePath.split('/')[0], {
              search: storagePath.split('/').pop()
            });

          const fileSize = fileInfo?.[0]?.metadata?.size || 0;
          const originalFilename = storagePath.split('/').pop() || 'unknown';

          // Criar registro de metadados
          const { error: metadataError } = await supabase
            .from('forum_attachment_metadata')
            .insert({
              post_id: post.id,
              storage_path: storagePath,
              file_type: fileType,
              mime_type: mimeType,
              file_size: fileSize,
              original_filename: originalFilename
            });

          if (metadataError) {
            console.error('Error creating attachment metadata:', metadataError);
          }

          // Disparar processamento EXIF para imagens (background task)
          if (fileType === 'image') {
            supabase.functions.invoke('extract-image-metadata', {
              body: { storage_path: storagePath, post_id: post.id }
            }).catch(err => console.error('Error invoking extract-image-metadata:', err));
          }
        } catch (attachmentError) {
          console.error('Error processing attachment:', attachmentError);
          // Continuar mesmo se houver erro em um anexo
        }
      }
    }

    // Inserir menções
    for (const mentionedUser of mentionedUsers) {
      await supabase.from('forum_mentions').insert({
        post_id: post.id,
        mentioned_user_id: mentionedUser.id,
        mentioned_by: user.id
      });

      // Notificar usuário mencionado
      await supabase.rpc('create_notification', {
        _user_id: mentionedUser.id,
        _type: 'forum_mention',
        _title: 'Você foi mencionado',
        _message: `${user.id} mencionou você em um fórum`,
        _metadata: { post_id: post.id, topic_id }
      });
    }

    // Inserir hashtags
    for (const hashtagId of hashtagIds) {
      await supabase.from('forum_post_hashtags').insert({
        post_id: post.id,
        hashtag_id: hashtagId
      });
    }

    // Notificar seguidores do tópico
    const { data: subscribers } = await supabase
      .from('forum_subscriptions')
      .select('user_id')
      .eq('topic_id', topic_id)
      .eq('notify_on_reply', true);

    if (subscribers) {
      for (const sub of subscribers) {
        if (sub.user_id !== user.id) {
          await supabase.rpc('create_notification', {
            _user_id: sub.user_id,
            _type: 'forum_reply',
            _title: 'Nova resposta no fórum',
            _message: 'Novo post no tópico que você segue',
            _metadata: { post_id: post.id, topic_id }
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, post }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in create-forum-post:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});