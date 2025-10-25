import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Navigation from '@/components/Navigation';
import { MessageSquare, Pin, Lock, CheckCircle, Search, Flame } from 'lucide-react';

export default function Forums() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: topics, isLoading } = useQuery({
    queryKey: ['forum-topics', searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('forum_topics')
        .select('*, profiles(name)')
        .eq('is_active', true)
        .order('is_pinned', { ascending: false })
        .order('last_post_at', { ascending: false, nullsFirst: false });

      if (searchQuery) {
        query = query.ilike('title', `%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      conhecimento_tecnico: 'Conhecimento Técnico',
      boas_praticas: 'Boas Práticas',
      campanhas: 'Campanhas',
      seguranca: 'Segurança',
      inovacao: 'Inovação',
      duvidas: 'Dúvidas',
      feedback: 'Feedback'
    };
    return labels[category] || category;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 pb-24 space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Fóruns de Conhecimento</h1>
          <p className="text-muted-foreground">Compartilhe experiências e aprenda com a equipe</p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar tópicos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="space-y-4">
          {topics?.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Nenhum tópico encontrado</p>
              </CardContent>
            </Card>
          )}

          {topics?.map(topic => (
            <Card
              key={topic.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => navigate(`/forum/${topic.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      {topic.is_pinned && (
                        <Badge variant="secondary" className="gap-1">
                          <Pin className="h-3 w-3" />
                          Fixado
                        </Badge>
                      )}
                      {topic.is_locked && (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="h-3 w-3" />
                          Fechado
                        </Badge>
                      )}
                      {topic.title}
                    </CardTitle>
                    <CardDescription className="mt-2">{topic.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-4 w-4" />
                    {topic.posts_count || 0} respostas
                  </span>
                  {topic.category && (
                    <Badge variant="outline">{getCategoryLabel(topic.category)}</Badge>
                  )}
                  {topic.posts_count > 10 && (
                    <Badge variant="secondary" className="gap-1">
                      <Flame className="h-3 w-3" />
                      Ativo
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      <Navigation />
    </div>
  );
}