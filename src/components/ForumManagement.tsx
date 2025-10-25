import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { toast } from './ui/use-toast';
import { MessageSquare, Pin, Lock, CheckCircle } from 'lucide-react';

const categories = [
  { value: 'conhecimento_tecnico', label: 'Conhecimento Técnico' },
  { value: 'boas_praticas', label: 'Boas Práticas' },
  { value: 'campanhas', label: 'Campanhas' },
  { value: 'seguranca', label: 'Segurança' },
  { value: 'inovacao', label: 'Inovação' },
  { value: 'duvidas', label: 'Dúvidas' },
  { value: 'feedback', label: 'Feedback' }
];

export function ForumManagement() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('conhecimento_tecnico');

  const { data: topics } = useQuery({
    queryKey: ['forum-topics-manage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('forum_topics')
        .select('*, profiles(name)')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  const createTopicMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('forum_topics').insert({
        title,
        description,
        category,
        created_by: user.id
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-topics-manage'] });
      setTitle('');
      setDescription('');
      toast({ title: 'Tópico criado com sucesso!' });
    },
    onError: (error) => {
      toast({ title: 'Erro ao criar tópico', description: error.message, variant: 'destructive' });
    }
  });

  const togglePinMutation = useMutation({
    mutationFn: async ({ id, is_pinned }: { id: string; is_pinned: boolean }) => {
      const { error } = await supabase
        .from('forum_topics')
        .update({ is_pinned: !is_pinned })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-topics-manage'] });
      toast({ title: 'Status atualizado!' });
    }
  });

  const toggleLockMutation = useMutation({
    mutationFn: async ({ id, is_locked }: { id: string; is_locked: boolean }) => {
      const { error } = await supabase
        .from('forum_topics')
        .update({ is_locked: !is_locked })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-topics-manage'] });
      toast({ title: 'Status atualizado!' });
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Criar Novo Tópico</CardTitle>
          <CardDescription>Inicie uma discussão ou compartilhe conhecimento</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Digite o título (mín. 10 caracteres)"
              minLength={10}
              maxLength={200}
            />
          </div>

          <div>
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o contexto (mín. 50 caracteres)"
              minLength={50}
              rows={4}
            />
          </div>

          <div>
            <Label htmlFor="category">Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => createTopicMutation.mutate()}
            disabled={title.length < 10 || description.length < 50 || createTopicMutation.isPending}
          >
            Criar Tópico
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Seus Tópicos</h3>
        {topics?.map(topic => (
          <Card key={topic.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2">
                    {topic.is_pinned && <Pin className="h-4 w-4 text-accent" />}
                    {topic.is_locked && <Lock className="h-4 w-4 text-muted-foreground" />}
                    {topic.title}
                  </CardTitle>
                  <CardDescription>{topic.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-4 w-4" />
                  {topic.posts_count} posts
                </span>
                <span className="capitalize">{topic.category?.replace('_', ' ')}</span>
              </div>
              
              <div className="flex gap-2 mt-4">
                <Button
                  size="sm"
                  variant={topic.is_pinned ? "default" : "outline"}
                  onClick={() => togglePinMutation.mutate({ id: topic.id, is_pinned: topic.is_pinned })}
                >
                  <Pin className="h-4 w-4 mr-1" />
                  {topic.is_pinned ? 'Despinar' : 'Fixar'}
                </Button>
                <Button
                  size="sm"
                  variant={topic.is_locked ? "destructive" : "outline"}
                  onClick={() => toggleLockMutation.mutate({ id: topic.id, is_locked: topic.is_locked })}
                >
                  <Lock className="h-4 w-4 mr-1" />
                  {topic.is_locked ? 'Desbloquear' : 'Bloquear'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}