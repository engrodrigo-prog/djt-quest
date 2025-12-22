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
import { apiFetch } from '@/lib/api';
import { MessageSquare, Pin, Lock, CheckCircle, Wand2 } from 'lucide-react';
import { VoiceRecorderButton } from './VoiceRecorderButton';
import { CompendiumPicker } from '@/components/CompendiumPicker';
import { getActiveLocale } from '@/lib/i18n/activeLocale';
import { localeToOpenAiLanguageTag, localeToSpeechLanguage } from '@/lib/i18n/language';

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
  const [compOpen, setCompOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [range, setRange] = useState<'30' | '60' | '180' | '365' | 'all'>('30');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

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
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const resp = await apiFetch('/api/forum?handler=create-topic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, description, category }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || 'Erro ao criar tópico');
      }
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

  const deleteTopicMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Não autenticado');
      const resp = await apiFetch('/api/forum?handler=moderate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'delete_topic', topic_id: id }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao excluir tópico');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-topics-manage'] });
      toast({ title: 'Tópico excluído e XP relacionado revertido (quando aplicável).' });
    },
    onError: (error: any) => {
      toast({ title: 'Erro ao excluir tópico', description: error?.message || 'Tente novamente', variant: 'destructive' });
    }
  });

  const startEditTopic = (topic: any) => {
    setEditingId(topic.id);
    setEditTitle(topic.title || '');
    setEditDescription(topic.description || '');
  };

  const saveEditTopic = async (topic: any) => {
    const newTitle = editTitle.trim();
    const newDesc = editDescription.trim();
    if (!newTitle) {
      toast({ title: 'Informe um título para o tópico.' });
      return;
    }
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      const before = {
        title: topic.title,
        description: topic.description,
        category: topic.category,
      };
      const after = {
        title: newTitle,
        description: newDesc,
        category: topic.category,
      };
      const { error } = await supabase
        .from('forum_topics')
        .update({ title: newTitle, description: newDesc })
        .eq('id', topic.id);
      if (error) throw error;
      if (uid) {
        await supabase.from('content_change_requests').insert({
          item_type: 'forum_topic',
          item_id: topic.id,
          action: 'update',
          requested_by: uid,
          status: 'pending',
          payload_before: before,
          payload_after: after,
        });
      }
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['forum-topics-manage'] });
      toast({ title: 'Tópico atualizado. Alteração enviada para validação do nível superior.' });
    } catch (e: any) {
      toast({ title: 'Erro ao salvar tópico', description: e?.message || 'Tente novamente', variant: 'destructive' });
    }
  };

  const cutoff = (() => {
    if (range === 'all') return null;
    const days = range === '30' ? 30 : range === '60' ? 60 : range === '180' ? 180 : 365;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  })();

  const filteredTopics = (topics || []).filter((t: any) => {
    if (!cutoff) return true;
    if (!t.created_at) return true;
    const d = new Date(t.created_at);
    return d >= cutoff;
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Criar Novo Tópico</CardTitle>
              <CardDescription>Inicie uma discussão ou compartilhe conhecimento</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setCompOpen(true)}>
              Buscar no Compêndio
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <CompendiumPicker
            open={compOpen}
            onOpenChange={setCompOpen}
            onPick={(item) => {
              const cat = item.final?.catalog || item.final || item.catalog || {};
              const t = String(cat.title || 'Ocorrência');
              const summary = String(cat.summary || '').trim();
              const prompts = Array.isArray(cat.suggested_forum_prompts) ? cat.suggested_forum_prompts : [];
              const failure = String(cat.failure_mode || '').trim();
              const root = String(cat.root_cause || '').trim();
              setTitle(`Debate: ${t}`.slice(0, 200));
              const body = [
                summary,
                failure ? `Modo de falha: ${failure}` : '',
                root ? `Causa raiz: ${root}` : '',
                prompts.length ? `Perguntas para debate:\n- ${prompts.slice(0, 5).join('\n- ')}` : '',
              ]
                .filter((v) => v && String(v).trim().length > 0)
                .join('\n\n');
              setDescription(body);
            }}
            title="Buscar ocorrência para base do fórum"
            description="Selecionar um relatório do Compêndio para gerar um tópico de debate"
          />
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

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="description">Descrição</Label>
              <div className="flex items-center gap-2">
                <VoiceRecorderButton
                  language={localeToSpeechLanguage(getActiveLocale())}
                  onText={(text) =>
                    setDescription((prev) =>
                      [prev, text].filter((v) => v && v.trim().length > 0).join('\n\n')
                    )
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={async () => {
                    if (!title.trim() || !description.trim()) {
                      toast({ title: 'Preencha título e descrição antes da revisão automática.' });
                      return;
                    }
                    setCleaning(true);
                    try {
                      const resp = await apiFetch('/api/ai?handler=cleanup-text', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, description, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
                      });
                      const json = await resp.json().catch(() => ({}));
                      if (!resp.ok || !json?.cleaned) {
                        throw new Error(json?.error || 'Falha na revisão automática');
                      }
                      setTitle(json.cleaned.title || title);
                      setDescription(json.cleaned.description || description);
                      toast({ title: 'Texto revisado com IA', description: 'Revise e ajuste antes de publicar.' });
                    } catch (e: any) {
                      toast({ title: 'Não foi possível revisar o texto agora', description: e?.message, variant: 'destructive' });
                    } finally {
                      setCleaning(false);
                    }
                  }}
                  disabled={cleaning}
                  title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o contexto (mín. 50 caracteres)"
              minLength={50}
              rows={4}
            />
          </div>

          <div className="flex flex-col gap-2">
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
            <p className="text-xs text-muted-foreground">
              Use categorias para, no futuro, visualizarmos temas em mapas e filtros por tipo (fórum, desafio, quiz).
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              onClick={() => createTopicMutation.mutate()}
              disabled={title.length < 10 || description.length < 50 || createTopicMutation.isPending}
            >
              Criar Tópico
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Seus Tópicos</h3>
          <div className="flex items-center gap-2 text-xs">
            {[
              { key: '30', label: '30 dias' },
              { key: '60', label: '60 dias' },
              { key: '180', label: 'Semestre' },
              { key: '365', label: 'Ano' },
              { key: 'all', label: 'Tudo' },
            ].map((opt) => (
              <Button
                key={opt.key}
                size="xs"
                variant={range === opt.key ? 'secondary' : 'outline'}
                onClick={() => setRange(opt.key as any)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
        {filteredTopics.map(topic => {
          const isEditing = editingId === topic.id;
          return (
            <Card key={topic.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      {topic.is_pinned && <Pin className="h-4 w-4 text-accent" />}
                      {topic.is_locked && <Lock className="h-4 w-4 text-muted-foreground" />}
                      {isEditing ? (
                        <input
                          className="w-full text-sm font-semibold bg-black/40 border border-white/10 rounded px-2 py-1 text-blue-50"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                      ) : (
                        topic.title
                      )}
                    </CardTitle>
                    {isEditing ? (
                      <textarea
                        className="w-full text-xs bg-black/40 border border-white/10 rounded px-2 py-1 text-muted-foreground"
                        rows={3}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    ) : (
                      <CardDescription>{topic.description}</CardDescription>
                    )}
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
                  {isEditing ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => saveEditTopic(topic)}
                      >
                        Salvar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEditTopic(topic)}
                    >
                      Editar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (!confirm('Excluir este tópico e reverter XP associado a respostas marcadas como solução?')) return;
                      deleteTopicMutation.mutate(topic.id);
                    }}
                  >
                    Excluir Tópico
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
