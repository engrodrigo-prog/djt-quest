import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Shield, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Navigation from '@/components/Navigation';

interface PendingEvent {
  id: string;
  title: string;
  description: string;
  submitted_at: string;
  user_name: string;
  sla_status: 'green' | 'yellow' | 'red';
  days_remaining: number;
  evidenceUrls?: string[];
}

const Evaluations = () => {
  const { user, userRole, studioAccess, orgScope } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<PendingEvent | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  
  // Evaluation form state
  const [scores, setScores] = useState({
    criterio1: 3,
    criterio2: 3,
    criterio3: 3,
    criterio4: 3,
    criterio5: 3,
  });
  const [feedbackPositivo, setFeedbackPositivo] = useState('');
  const [feedbackConstrutivo, setFeedbackConstrutivo] = useState('');

  const loadPendingEvaluations = useCallback(async () => {
    try {
      if (!user) return;
      // Load from evaluation_queue assigned to me and not completed
      const { data: rows, error } = await supabase
        .from('evaluation_queue')
        .select(`
          event_id,
          events!inner(
            id, created_at, payload,
            challenges(title, description),
            profiles:profiles!events_user_id_fkey(name)
          )
        `)
        .eq('assigned_to', user.id)
        .is('completed_at', null)
        .limit(25);

      if (error) throw error;

      const mappedEvents: PendingEvent[] = (rows || []).map((row: any) => {
        const event = row.events;
        const daysOld = Math.floor((Date.now() - new Date(event?.created_at).getTime()) / (1000 * 60 * 60 * 24));
        const payload = event?.payload || {};
        return {
          id: event?.id,
          title: event?.challenges?.title || 'Sem título',
          description: payload.description || event?.challenges?.description || 'Sem descrição',
          submitted_at: event?.created_at,
          user_name: event?.profiles?.name || 'Desconhecido',
          days_remaining: 5 - daysOld,
          sla_status: daysOld < 3 ? 'green' : daysOld < 5 ? 'yellow' : 'red',
          evidenceUrls: Array.isArray(payload.evidence_urls) ? payload.evidence_urls : [],
        };
      });

      setPendingEvents(mappedEvents);
    } catch (error: any) {
      console.error('Error loading evaluations:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar avaliações pendentes',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    if (user && studioAccess) {
      loadPendingEvaluations();
    } else {
      setLoading(false);
    }
  }, [loadPendingEvaluations, studioAccess, user]);

  const handleSubmitEvaluation = async () => {
    if (!selectedEvent) return;

    if (feedbackPositivo.length < 140) {
      toast({
        title: 'Feedback Incompleto',
        description: 'O feedback positivo deve ter no mínimo 140 caracteres',
        variant: 'destructive'
      });
      return;
    }

    if (feedbackConstrutivo.length < 140) {
      toast({
        title: 'Feedback Incompleto',
        description: 'O feedback construtivo deve ter no mínimo 140 caracteres',
        variant: 'destructive'
      });
      return;
    }

    setEvaluating(true);

    try {
      const { data, error } = await supabase.functions.invoke('studio-evaluations', {
        body: {
          eventId: selectedEvent.id,
          scores,
          feedbackPositivo,
          feedbackConstrutivo,
        }
      });

      if (error) throw error;

      toast({
        title: 'Avaliação Enviada!',
        description: data.message || 'Avaliação registrada com sucesso',
      });

      setSelectedEvent(null);
      setScores({
        criterio1: 3,
        criterio2: 3,
        criterio3: 3,
        criterio4: 3,
        criterio5: 3,
      });
      setFeedbackPositivo('');
      setFeedbackConstrutivo('');

      loadPendingEvaluations();
    } catch (error: any) {
      console.error('Error submitting evaluation:', error);
      toast({
        title: 'Erro ao Avaliar',
        description: error.message || 'Não foi possível enviar a avaliação',
        variant: 'destructive'
      });
    } finally {
      setEvaluating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!studioAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Apenas coordenadores, líderes e gerentes podem avaliar ações.
            </CardDescription>
          </CardHeader>
        </Card>
        <Navigation />
      </div>
    );
  }

  const avgScore = Object.values(scores).reduce((a, b) => a + b, 0) / 5;
  const canSubmit = feedbackPositivo.length >= 140 && feedbackConstrutivo.length >= 140;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 pb-40 md:pb-20">
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            Avaliações 2L
          </h1>
          <p className="text-muted-foreground">
            Seu escopo: <strong>{userRole === 'coordenador_djtx' ? 'Coordenação' : userRole === 'lider_divisao_djtx' ? 'Divisão DJTX' : 'Departamento DJT'}</strong>
          </p>
        </div>

        {!selectedEvent ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Fila de Avaliações Pendentes</CardTitle>
                <CardDescription>
                  Ações aguardando sua avaliação de {userRole === 'coordenador_djtx' ? 'Coordenação (34%)' : 'Divisão (66%)'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pendingEvents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
                    <p>Nenhuma avaliação pendente no momento.</p>
                    <p className="text-sm">Volte mais tarde.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingEvents.map((event) => (
                      <Card key={event.id} className="cursor-pointer hover:border-primary transition-colors">
                        <CardContent className="p-4" onClick={() => setSelectedEvent(event)}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h3 className="font-semibold">{event.title}</h3>
                              <p className="text-sm text-muted-foreground">Por: {event.user_name}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={event.sla_status === 'green' ? 'default' : event.sla_status === 'yellow' ? 'secondary' : 'destructive'}>
                                <Clock className="h-3 w-3 mr-1" />
                                {event.days_remaining}d
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            <Button variant="ghost" onClick={() => setSelectedEvent(null)}>
              ← Voltar para fila
            </Button>

            <Card>
              <CardHeader>
                <CardTitle>Avaliando: {selectedEvent.title}</CardTitle>
                <CardDescription>Submissão por {selectedEvent.user_name}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-2">Descrição da Ação</h3>
                  <p className="text-sm text-muted-foreground">{selectedEvent.description}</p>
                </div>

                {selectedEvent.evidenceUrls && selectedEvent.evidenceUrls.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2">Evidências</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {selectedEvent.evidenceUrls.slice(0,6).map((url, idx) => (
                        <a href={url} target="_blank" rel="noreferrer" key={idx} className="block group">
                          <img src={url} alt={`evidência ${idx+1}`} className="w-full h-24 object-cover rounded-md border group-hover:opacity-90" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <h3 className="font-semibold">Critérios de Avaliação (1.0 - 5.0)</h3>
                  
                  {Object.keys(scores).map((key, index) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Critério {index + 1}</Label>
                        <span className="text-sm font-bold">{scores[key as keyof typeof scores].toFixed(1)}</span>
                      </div>
                      <Slider
                        value={[scores[key as keyof typeof scores]]}
                        onValueChange={(value) => setScores({ ...scores, [key]: value[0] })}
                        min={1}
                        max={5}
                        step={0.5}
                        className="w-full"
                      />
                    </div>
                  ))}

                  <div className="p-3 bg-primary/10 rounded-lg">
                    <p className="text-sm font-semibold">
                      Nota Média: <span className="text-xl text-primary">{avgScore.toFixed(2)}</span> / 5.0
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Feedback Positivo (mínimo 140 caracteres)</Label>
                  <Textarea
                    placeholder="Descreva os pontos fortes desta ação..."
                    value={feedbackPositivo}
                    onChange={(e) => setFeedbackPositivo(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    {feedbackPositivo.length} / 140 caracteres
                    {feedbackPositivo.length < 140 && (
                      <span className="text-destructive ml-2">
                        <AlertCircle className="h-3 w-3 inline mr-1" />
                        Necessário mais {140 - feedbackPositivo.length} caracteres
                      </span>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Feedback Construtivo (mínimo 140 caracteres)</Label>
                  <Textarea
                    placeholder="Descreva oportunidades de melhoria..."
                    value={feedbackConstrutivo}
                    onChange={(e) => setFeedbackConstrutivo(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    {feedbackConstrutivo.length} / 140 caracteres
                    {feedbackConstrutivo.length < 140 && (
                      <span className="text-destructive ml-2">
                        <AlertCircle className="h-3 w-3 inline mr-1" />
                        Necessário mais {140 - feedbackConstrutivo.length} caracteres
                      </span>
                    )}
                  </p>
                </div>

                <Button 
                  onClick={handleSubmitEvaluation} 
                  disabled={!canSubmit || evaluating}
                  className="w-full"
                  size="lg"
                >
                  {evaluating ? 'Enviando...' : 'Submeter Avaliação'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Navigation />
    </div>
  );
};

export default Evaluations;
