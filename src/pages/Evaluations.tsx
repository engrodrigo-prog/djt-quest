import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Shield, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface EventToEvaluate {
  id: string;
  created_at: string;
  payload: any;
  evidence_urls: string[] | null;
  status: string;
  user: {
    name: string;
  };
  challenge: {
    title: string;
    type: string;
  };
}

interface EvaluationScores {
  impactoSeguranca: number;
  aderenciaAMP: number;
  replicabilidade: number;
  clarezaExecucao: number;
  valorPedagogico: number;
}

const Evaluations = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<EventToEvaluate[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventToEvaluate | null>(null);
  const [scores, setScores] = useState<EvaluationScores>({
    impactoSeguranca: 3,
    aderenciaAMP: 3,
    replicabilidade: 3,
    clarezaExecucao: 3,
    valorPedagogico: 3
  });
  const [feedbackPositivo, setFeedbackPositivo] = useState('');
  const [feedbackConstrutivo, setFeedbackConstrutivo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (!user) return;

      // Get user role
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (!roleData) {
        setLoading(false);
        return;
      }

      setUserRole(roleData.role);

      // Only leaders can evaluate
      if (!['lider_divisao', 'coordenador', 'gerente', 'admin'].includes(roleData.role)) {
        setLoading(false);
        return;
      }

      // Load events pending evaluation
      const { data: eventsData } = await supabase
        .from('events')
        .select(`
          id,
          created_at,
          payload,
          evidence_urls,
          status,
          user:profiles(name),
          challenge:challenges(title, type)
        `)
        .eq('status', 'submitted')
        .order('created_at', { ascending: true });

      if (eventsData) {
        setEvents(eventsData as any);
      }

      setLoading(false);
    };

    loadData();
  }, [user]);

  const handleSubmitEvaluation = async () => {
    if (!selectedEvent || !user || !userRole) return;

    const totalFeedback = feedbackPositivo.trim().length + feedbackConstrutivo.trim().length;
    if (totalFeedback < 140) {
      toast({
        title: 'Erro',
        description: 'Feedback deve ter pelo menos 140 caracteres (positivo ou construtivo)',
        variant: 'destructive'
      });
      return;
    }

    setSubmitting(true);

    try {
      const avgRating = Object.values(scores).reduce((a, b) => a + b, 0) / 5;
      const reviewerLevel = userRole === 'lider_divisao' ? 'divisao' : 'coordenacao';

      const { error } = await supabase
        .from('action_evaluations')
        .insert([{
          event_id: selectedEvent.id,
          reviewer_id: user.id,
          reviewer_level: reviewerLevel,
          scores: scores as any,
          rating: avgRating,
          feedback_positivo: feedbackPositivo.trim() || null,
          feedback_construtivo: feedbackConstrutivo.trim() || null
        }]);

      if (error) throw error;

      toast({
        title: 'Avaliação submetida!',
        description: 'Sua avaliação foi registrada com sucesso.'
      });

      // Reload events
      setEvents(events.filter(e => e.id !== selectedEvent.id));
      setSelectedEvent(null);
      setFeedbackPositivo('');
      setFeedbackConstrutivo('');
      setScores({
        impactoSeguranca: 3,
        aderenciaAMP: 3,
        replicabilidade: 3,
        clarezaExecucao: 3,
        valorPedagogico: 3
      });
    } catch (error) {
      console.error('Error submitting evaluation:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível submeter a avaliação',
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!userRole || !['lider_divisao', 'coordenador', 'gerente', 'admin'].includes(userRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Apenas líderes podem acessar esta página.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (selectedEvent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
        <div className="container max-w-3xl mx-auto py-8 space-y-6">
          <Button variant="ghost" onClick={() => setSelectedEvent(null)}>
            Voltar à Fila
          </Button>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between mb-2">
                <Badge>{selectedEvent.challenge.type}</Badge>
                <Badge variant="outline">{selectedEvent.user.name}</Badge>
              </div>
              <CardTitle>{selectedEvent.challenge.title}</CardTitle>
              <CardDescription>
                Submetido em {new Date(selectedEvent.created_at).toLocaleDateString('pt-BR')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Descrição da Ação:</Label>
                <p className="text-sm bg-muted p-4 rounded-lg">
                  {selectedEvent.payload?.description || 'Sem descrição'}
                </p>
                {selectedEvent.evidence_urls && selectedEvent.evidence_urls.length > 0 && (
                  <div className="mt-4">
                    <Label className="text-sm font-semibold">Evidências:</Label>
                    <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                      {selectedEvent.evidence_urls.map((url, i) => (
                        <li key={i}>
                          <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            Evidência {i + 1}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-accent" />
                Rubrica de Avaliação
              </CardTitle>
              <CardDescription>
                Avalie cada critério de 1 a 5 (incrementos de 0,5)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {Object.entries({
                impactoSeguranca: 'Impacto em Segurança',
                aderenciaAMP: 'Aderência Documental (AMP)',
                replicabilidade: 'Replicabilidade',
                clarezaExecucao: 'Clareza de Execução',
                valorPedagogico: 'Valor Pedagógico'
              }).map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <div className="flex justify-between">
                    <Label>{label}</Label>
                    <span className="font-semibold text-accent">{scores[key as keyof EvaluationScores]}</span>
                  </div>
                  <Slider
                    value={[scores[key as keyof EvaluationScores]]}
                    onValueChange={([value]) => setScores({ ...scores, [key]: value })}
                    min={1}
                    max={5}
                    step={0.5}
                    className="w-full"
                  />
                </div>
              ))}

              <div className="pt-4 border-t space-y-4">
                <div>
                  <Label htmlFor="positivo">Feedback Positivo</Label>
                  <Textarea
                    id="positivo"
                    placeholder="Destaque os pontos fortes e boas práticas observadas..."
                    value={feedbackPositivo}
                    onChange={(e) => setFeedbackPositivo(e.target.value)}
                    rows={4}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="construtivo">Feedback Construtivo</Label>
                  <Textarea
                    id="construtivo"
                    placeholder="Sugira melhorias e oportunidades de aprendizado..."
                    value={feedbackConstrutivo}
                    onChange={(e) => setFeedbackConstrutivo(e.target.value)}
                    rows={4}
                    className="mt-2"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Total: {feedbackPositivo.length + feedbackConstrutivo.length}/140 caracteres (pelo menos um campo obrigatório)
                </p>
              </div>

              <Button 
                onClick={handleSubmitEvaluation}
                disabled={submitting || (feedbackPositivo.trim().length + feedbackConstrutivo.trim().length < 140)}
                className="w-full"
              >
                {submitting ? 'Enviando...' : 'Enviar Avaliação'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Fila de Avaliações</h1>
            <p className="text-muted-foreground">
              {events.length} {events.length === 1 ? 'ação aguardando' : 'ações aguardando'} sua avaliação
            </p>
          </div>
          <Badge variant="outline" className="text-lg px-4 py-2">
            {userRole === 'lider_divisao' ? 'Líder Divisão' : userRole === 'coordenador' ? 'Coordenador' : 'Gestor'}
          </Badge>
        </div>

        {events.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <CheckCircle className="h-16 w-16 text-accent mb-4" />
              <p className="text-lg font-semibold">Nenhuma ação pendente!</p>
              <p className="text-sm text-muted-foreground">Você está em dia com suas avaliações.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <Card key={event.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between mb-2">
                    <Badge>{event.challenge.type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <CardTitle className="text-lg">{event.challenge.title}</CardTitle>
                  <CardDescription>Por: {event.user.name}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => setSelectedEvent(event)} className="w-full">
                    Avaliar
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Evaluations;
