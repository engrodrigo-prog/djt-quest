import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Shield, Clock, CheckCircle, AlertCircle, Wand2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Navigation from '@/components/Navigation';
import { getActiveLocale } from '@/lib/i18n/activeLocale';
import { localeToOpenAiLanguageTag } from '@/lib/i18n/language';
import { UserProfilePopover } from '@/components/UserProfilePopover';
import { apiFetch } from '@/lib/api';
import { AttachmentViewer } from '@/components/AttachmentViewer';

interface PendingEvent {
  id: string;
  title: string;
  description: string;
  submitted_at: string;
  user_id: string;
  user_name: string;
  sla_status: 'green' | 'yellow' | 'red';
  days_remaining: number;
  evidenceUrls?: string[];
  sepbookPostId?: string | null;
}

const FEEDBACK_MIN_CHARS = 10;
const EVALUATION_CRITERIA = [
  { key: 'criterio1', title: 'Contexto e clareza', description: 'Objetivo, cenário e ação descritos com clareza.' },
  { key: 'criterio2', title: 'Segurança e conformidade', description: 'Ação segura e alinhada às normas/boas práticas.' },
  { key: 'criterio3', title: 'Execução', description: 'Qualidade da execução e aderência ao plano.' },
  { key: 'criterio4', title: 'Resultado', description: 'Impacto/resultado alcançado ou evidenciado.' },
  { key: 'criterio5', title: 'Aprendizado', description: 'Lições aprendidas e potencial de replicação.' },
];

const Evaluations = () => {
  const { user, userRole, studioAccess, orgScope } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<PendingEvent | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  
  // Evaluation form state
  const [scores, setScores] = useState<Record<string, number>>(
    Object.fromEntries(EVALUATION_CRITERIA.map((c) => [c.key, 3])),
  );
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
            id, created_at, payload, user_id, evidence_urls,
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
        const payloadEvidence = Array.isArray(payload.evidence_urls) ? payload.evidence_urls : [];
        const columnEvidence = Array.isArray(event?.evidence_urls) ? event.evidence_urls : [];
        const evidenceMerged = Array.from(new Set([...(payloadEvidence as any), ...(columnEvidence as any)].filter(Boolean)));
        return {
          id: event?.id,
          title: event?.challenges?.title || 'Sem título',
          description: payload.description || event?.challenges?.description || 'Sem descrição',
          submitted_at: event?.created_at,
          user_id: event?.user_id || '',
          user_name: event?.profiles?.name || 'Desconhecido',
          days_remaining: 5 - daysOld,
          sla_status: daysOld < 3 ? 'green' : daysOld < 5 ? 'yellow' : 'red',
          evidenceUrls: evidenceMerged as any,
          sepbookPostId: payload?.sepbook_post_id ? String(payload.sepbook_post_id) : null,
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

    if (feedbackPositivo.length < FEEDBACK_MIN_CHARS) {
      toast({
        title: 'Feedback Incompleto',
        description: `O feedback positivo deve ter no mínimo ${FEEDBACK_MIN_CHARS} caracteres`,
        variant: 'destructive'
      });
      return;
    }

    if (feedbackConstrutivo.length < FEEDBACK_MIN_CHARS) {
      toast({
        title: 'Feedback Incompleto',
        description: `O feedback construtivo deve ter no mínimo ${FEEDBACK_MIN_CHARS} caracteres`,
        variant: 'destructive'
      });
      return;
    }

    setEvaluating(true);

    try {
      const avg =
        Object.values(scores).reduce((sum, value) => sum + (Number(value) || 0), 0) / EVALUATION_CRITERIA.length;
      const rating = Math.max(0, Math.min(10, Math.round(avg * 2 * 10) / 10));

      const { data, error } = await supabase.functions.invoke('studio-evaluations', {
        body: {
          eventId: selectedEvent.id,
          action: 'approve',
          rating,
          scores,
          feedbackPositivo,
          feedbackConstrutivo,
        }
      });

      if (error) {
        let message = error.message || 'Não foi possível enviar a avaliação';
        try {
          const ctx = (error as any)?.context as Response | undefined;
          const payload = ctx ? await ctx.json().catch(() => null) : null;
          if (payload?.error) message = String(payload.error);
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }

      toast({
        title: 'Avaliação Enviada!',
        description: data.message || 'Avaliação registrada com sucesso',
      });

      setSelectedEvent(null);
      setScores(Object.fromEntries(EVALUATION_CRITERIA.map((c) => [c.key, 3])));
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
  const canSubmit = feedbackPositivo.length >= FEEDBACK_MIN_CHARS && feedbackConstrutivo.length >= FEEDBACK_MIN_CHARS;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 pb-40">
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
                              <p className="text-sm text-muted-foreground">
                                Por:{" "}
                                <UserProfilePopover userId={event.user_id} name={event.user_name}>
                                  <button
                                    type="button"
                                    className="text-sm text-muted-foreground hover:underline p-0 bg-transparent border-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {event.user_name}
                                  </button>
                                </UserProfilePopover>
                              </p>
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

                {(selectedEvent.evidenceUrls && selectedEvent.evidenceUrls.length > 0) || selectedEvent.sepbookPostId ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">Evidências</h3>
                      {selectedEvent.sepbookPostId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/sepbook#post-${encodeURIComponent(String(selectedEvent.sepbookPostId))}`)}
                        >
                          Abrir no SEPBook
                        </Button>
                      ) : null}
                    </div>
                    {selectedEvent.evidenceUrls && selectedEvent.evidenceUrls.length > 0 ? (
                      <AttachmentViewer urls={selectedEvent.evidenceUrls} mediaLayout="carousel" />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Sem anexos neste envio (evidência apenas em texto/feedback).
                      </p>
                    )}
                  </div>
                ) : null}

                <div className="space-y-4">
                  <h3 className="font-semibold">Critérios de Avaliação (1.0 - 5.0)</h3>
                  
                  {EVALUATION_CRITERIA.map((criterion, index) => {
                    const score = scores[criterion.key] ?? 3;
                    return (
                      <div key={criterion.key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>{`${index + 1}. ${criterion.title}`}</Label>
                          <span className="text-sm font-bold">{score.toFixed(1)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{criterion.description}</p>
                        <Slider
                          value={[score]}
                          onValueChange={(value) => setScores({ ...scores, [criterion.key]: value[0] })}
                          min={1}
                          max={5}
                          step={0.5}
                          className="w-full"
                        />
                      </div>
                    );
                  })}

                  <div className="p-3 bg-primary/10 rounded-lg">
                    <p className="text-sm font-semibold">
                      Nota Média: <span className="text-xl text-primary">{avgScore.toFixed(2)}</span> / 5.0
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{`Feedback Positivo (mínimo ${FEEDBACK_MIN_CHARS} caracteres)`}</Label>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={async () => {
                        const text = feedbackPositivo.trim();
                        if (text.length < 3) {
                          toast({
                            title: 'Nada para revisar',
                            description: 'Digite o feedback positivo antes de pedir correção.',
                          });
                          return;
                        }
                        try {
                          const resp = await apiFetch('/api/ai?handler=cleanup-text', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: 'Feedback positivo', description: text, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
                          });
                          const j = await resp.json().catch(() => ({}));
                          const usedAI = j?.meta?.usedAI !== false;
                          if (!resp.ok || !j?.cleaned?.description) {
                            throw new Error(j?.error || 'Falha na revisão automática');
                          }
                          if (!usedAI) {
                            toast({ title: 'Não foi possível revisar agora', description: 'IA indisponível no momento. Tente novamente mais tarde.', variant: 'destructive' });
                            return;
                          }
                          const cleaned = String(j.cleaned.description || text).trim();
                          if (cleaned === text) {
                            toast({ title: 'Nenhuma correção necessária', description: 'Não encontrei ajustes de ortografia/pontuação para fazer.' });
                            return;
                          }
                          setFeedbackPositivo(cleaned);
                          toast({ title: 'Feedback positivo revisado', description: 'Ortografia e pontuação ajustadas.' });
                        } catch (e: any) {
                          toast({ title: 'Não foi possível revisar agora', description: e?.message || 'Tente novamente mais tarde.', variant: 'destructive' });
                        }
                      }}
                      title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                    >
                      <Wand2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    placeholder="Descreva os pontos fortes desta ação..."
                    value={feedbackPositivo}
                    onChange={(e) => setFeedbackPositivo(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    {feedbackPositivo.length} / {FEEDBACK_MIN_CHARS} caracteres
                    {feedbackPositivo.length < FEEDBACK_MIN_CHARS && (
                      <span className="text-destructive ml-2">
                        <AlertCircle className="h-3 w-3 inline mr-1" />
                        Necessário mais {FEEDBACK_MIN_CHARS - feedbackPositivo.length} caracteres
                      </span>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{`Feedback Construtivo (mínimo ${FEEDBACK_MIN_CHARS} caracteres)`}</Label>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={async () => {
                        const text = feedbackConstrutivo.trim();
                        if (text.length < 3) {
                          toast({
                            title: 'Nada para revisar',
                            description: 'Digite o feedback construtivo antes de pedir correção.',
                          });
                          return;
                        }
                        try {
                          const resp = await apiFetch('/api/ai?handler=cleanup-text', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: 'Feedback construtivo', description: text, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
                          });
                          const j = await resp.json().catch(() => ({}));
                          const usedAI = j?.meta?.usedAI !== false;
                          if (!resp.ok || !j?.cleaned?.description) {
                            throw new Error(j?.error || 'Falha na revisão automática');
                          }
                          if (!usedAI) {
                            toast({ title: 'Não foi possível revisar agora', description: 'IA indisponível no momento. Tente novamente mais tarde.', variant: 'destructive' });
                            return;
                          }
                          const cleaned = String(j.cleaned.description || text).trim();
                          if (cleaned === text) {
                            toast({ title: 'Nenhuma correção necessária', description: 'Não encontrei ajustes de ortografia/pontuação para fazer.' });
                            return;
                          }
                          setFeedbackConstrutivo(cleaned);
                          toast({ title: 'Feedback construtivo revisado', description: 'Ortografia e pontuação ajustadas.' });
                        } catch (e: any) {
                          toast({ title: 'Não foi possível revisar agora', description: e?.message || 'Tente novamente mais tarde.', variant: 'destructive' });
                        }
                      }}
                      title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                    >
                      <Wand2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    placeholder="Descreva oportunidades de melhoria..."
                    value={feedbackConstrutivo}
                    onChange={(e) => setFeedbackConstrutivo(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    {feedbackConstrutivo.length} / {FEEDBACK_MIN_CHARS} caracteres
                    {feedbackConstrutivo.length < FEEDBACK_MIN_CHARS && (
                      <span className="text-destructive ml-2">
                        <AlertCircle className="h-3 w-3 inline mr-1" />
                        Necessário mais {FEEDBACK_MIN_CHARS - feedbackConstrutivo.length} caracteres
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
