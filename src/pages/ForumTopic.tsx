import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { toast } from '@/components/ui/use-toast';
import { TierBadge } from '@/components/TierBadge';
import { AttachmentUploader } from '@/components/AttachmentUploader';
import { AttachmentViewer } from '@/components/AttachmentViewer';
import { ArrowLeft, ThumbsUp, MessageCircle, CheckCircle, Star } from 'lucide-react';
import { sanitizeHtml } from '@/lib/sanitize';

export default function ForumTopic() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [replyContent, setReplyContent] = useState('');
  const [replyToPostId, setReplyToPostId] = useState<string | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);

  const { data: topic } = useQuery({
    queryKey: ['forum-topic', topicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('forum_topics')
        .select('*, profiles(name)')
        .eq('id', topicId)
        .single();
      
      if (error) throw error;
      
      // Incrementar views
      await supabase
        .from('forum_topics')
        .update({ views_count: data.views_count + 1 })
        .eq('id', topicId);
      
      return data;
    }
  });

  const { data: posts } = useQuery({
    queryKey: ['forum-posts', topicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('forum_posts')
        .select(`
          *,
          author:profiles!author_id(name, tier),
          forum_likes(user_id)
        `)
        .eq('topic_id', topicId)
        .order('is_solution', { ascending: false })
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data;
    }
  });

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('studio_access')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      return data;
    }
  });

  const createPostMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('create-forum-post', {
        body: {
          topic_id: topicId,
          content: replyContent,
          parent_post_id: replyToPostId,
          attachment_urls: attachmentUrls.length > 0 ? attachmentUrls : undefined
        }
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-posts', topicId] });
      queryClient.invalidateQueries({ queryKey: ['forum-topic', topicId] });
      setReplyContent('');
      setReplyToPostId(null);
      setAttachmentUrls([]);
      toast({ title: 'Resposta publicada!' });
    },
    onError: (error) => {
      toast({ title: 'Erro ao publicar', description: error.message, variant: 'destructive' });
    }
  });

  const toggleLikeMutation = useMutation({
    mutationFn: async (postId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('toggle-post-like', {
        body: { post_id: postId }
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-posts', topicId] });
    }
  });

  const markSolutionMutation = useMutation({
    mutationFn: async (postId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('mark-post-as-solution', {
        body: { post_id: postId }
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-posts', topicId] });
      toast({ title: 'Resposta marcada como solução!' });
    }
  });

  if (!topic) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const isLocked = topic.is_locked;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 pb-24 space-y-6">
        <Button variant="ghost" onClick={() => navigate('/forums')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{topic.title}</CardTitle>
            <p className="text-muted-foreground mt-2">{topic.description}</p>
            <div className="flex gap-2 mt-4">
              {topic.category && (
                <Badge variant="outline">{topic.category.replace('_', ' ')}</Badge>
              )}
              {isLocked && (
                <Badge variant="secondary">Fechado</Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        <div className="space-y-4">
          {posts?.map(post => (
            <Card key={post.id} className={post.is_solution ? 'border-primary' : ''}>
              <CardHeader>
                <div className="flex items-start gap-4">
                  <Avatar>
                    <AvatarFallback>{post.author?.name?.charAt(0) || '?'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{post.author?.name}</span>
                      {post.author?.tier && <TierBadge tierCode={post.author.tier} />}
                      {post.is_solution && (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Solução
                        </Badge>
                      )}
                      {post.is_featured && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="h-3 w-3" />
                          Destaque
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(post.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content_html || post.content || '') }}
                />
                
                {post.attachment_urls && post.attachment_urls.length > 0 && (
                  <AttachmentViewer urls={post.attachment_urls} postId={post.id} />
                )}
                
                <div className="flex items-center gap-4 mt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleLikeMutation.mutate(post.id)}
                  >
                    <ThumbsUp className="h-4 w-4 mr-1" />
                    {post.likes_count || 0}
                  </Button>
                  
                  {!isLocked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setReplyToPostId(post.id)}
                    >
                      <MessageCircle className="h-4 w-4 mr-1" />
                      Responder
                    </Button>
                  )}
                  
                  {profile?.studio_access && !post.is_solution && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markSolutionMutation.mutate(post.id)}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Marcar como solução
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {!isLocked && (
          <Card>
            <CardHeader>
              <CardTitle>
                {replyToPostId ? 'Respondendo...' : 'Sua Resposta'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Use @ para mencionar alguém e # para hashtags..."
                rows={4}
                minLength={10}
              />
              
              <AttachmentUploader
                onAttachmentsChange={setAttachmentUrls}
                maxFiles={10}
                maxSizeMB={50}
              />
              
              <p className="text-xs text-muted-foreground">
                Dica: Use @nome para mencionar e #tag para categorizar
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => createPostMutation.mutate()}
                  disabled={replyContent.length < 10 || createPostMutation.isPending}
                >
                  Publicar
                </Button>
                {replyToPostId && (
                  <Button variant="outline" onClick={() => setReplyToPostId(null)}>
                    Cancelar Resposta
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
