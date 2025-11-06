import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Upload, Shield } from 'lucide-react';
import { ThemedBackground, domainFromType } from '@/components/ThemedBackground';
import { useToast } from '@/hooks/use-toast';
import { QuizPlayer } from '@/components/QuizPlayer';

interface Challenge {
  id: string;
  title: string;
  description: string;
  type: string;
  xp_reward: number;
  require_two_leader_eval: boolean;
  campaign_id: string;
  evidence_required: boolean;
}

const ChallengeDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const retryEventId = searchParams.get('retry');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [description, setDescription] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [previousFeedback, setPreviousFeedback] = useState<{ positive: string | null; constructive: string | null } | null>(null);
  const [quizCompleted, setQuizCompleted] = useState(false);

  useEffect(() => {
    const loadChallenge = async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        toast({ title: 'Erro', description: 'Não foi possível carregar o desafio', variant: 'destructive' });
        navigate('/');
        return;
      }

      setChallenge(data);

      // Load previous feedback if this is a retry
      if (retryEventId) {
        const { data: retryEvent } = await supabase
          .from('events')
          .select('parent_event_id')
          .eq('id', retryEventId)
          .single();

        if (retryEvent?.parent_event_id) {
          const { data: evaluation } = await supabase
            .from('action_evaluations')
            .select('feedback_positivo, feedback_construtivo')
            .eq('event_id', retryEvent.parent_event_id)
            .maybeSingle();

          if (evaluation) {
            setPreviousFeedback({
              positive: evaluation.feedback_positivo,
              constructive: evaluation.feedback_construtivo
            });
          }
        }
      }

      // Se for quiz, verificar se já foi concluído
      if (data?.type?.toLowerCase?.().includes('quiz') && user) {
        const { count: totalQuestions } = await supabase
          .from('quiz_questions')
          .select('id', { count: 'exact', head: true })
          .eq('challenge_id', data.id);

        const { count: answeredQuestions } = await supabase
          .from('user_quiz_answers')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('challenge_id', data.id);

        setQuizCompleted((answeredQuestions || 0) >= (totalQuestions || 0));
      }

      setLoading(false);
    };

    loadChallenge();
  }, [id, retryEventId, navigate, toast]);

  const handleSubmit = async () => {
    if (!challenge || !user) return;
    
    if (description.length < 50) {
      toast({ title: 'Erro', description: 'Descrição deve ter pelo menos 50 caracteres', variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    try {
      if (retryEventId) {
        // Update existing retry event
        const { error } = await supabase
          .from('events')
          .update({
            payload: { description },
            evidence_urls: evidenceUrls.length > 0 ? evidenceUrls : null,
            status: 'submitted'
          })
          .eq('id', retryEventId);

        if (error) throw error;

        toast({
          title: 'Sucesso!',
          description: 'Refação submetida! Aguardando nova avaliação.'
        });
      } else {
        // Create new event
        const { error } = await supabase
          .from('events')
          .insert([{
            user_id: user.id,
            challenge_id: challenge.id,
            payload: { description },
            evidence_urls: evidenceUrls.length > 0 ? evidenceUrls : null,
            status: challenge.require_two_leader_eval ? 'submitted' : 'evaluated'
          }]);

        if (error) throw error;

        toast({
          title: 'Sucesso!',
          description: challenge.require_two_leader_eval 
            ? 'Ação submetida! Aguardando avaliação de 2 líderes.' 
            : 'Desafio concluído!'
        });
      }

      navigate('/profile');
    } catch (error) {
      console.error('Error submitting:', error);
      toast({ title: 'Erro', description: 'Não foi possível submeter a ação', variant: 'destructive' });
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

  if (!challenge) return null;

  const theme = domainFromType(challenge.type);

  return (
    <div className="relative min-h-screen bg-background p-4 overflow-hidden">
      <ThemedBackground theme={theme} />
      <div className="container max-w-2xl mx-auto py-8 space-y-6 relative">
        <Button variant="ghost" onClick={() => navigate('/profile')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar ao Perfil
        </Button>

        {retryEventId && (
          <Card className="border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20">
            <CardContent className="py-4">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                🔄 Você está refazendo este desafio
              </p>
              <p className="text-xs text-blue-800 dark:text-blue-200">
                Use o feedback anterior para melhorar sua submissão e demonstrar seu aprendizado!
              </p>
            </CardContent>
          </Card>
        )}

        {previousFeedback && (
          <Card className="border-yellow-200 dark:border-yellow-900">
            <CardHeader>
              <CardTitle className="text-sm">Feedback da Tentativa Anterior</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {previousFeedback.positive && (
                <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                  <p className="text-xs font-semibold text-green-900 dark:text-green-100 mb-1">
                    ✅ Pontos Positivos
                  </p>
                  <p className="text-xs text-green-800 dark:text-green-200">
                    {previousFeedback.positive}
                  </p>
                </div>
              )}
              {previousFeedback.constructive && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg">
                  <p className="text-xs font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
                    💡 Áreas de Melhoria
                  </p>
                  <p className="text-xs text-yellow-800 dark:text-yellow-200">
                    {previousFeedback.constructive}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <Badge>{challenge.type}</Badge>
              {challenge.xp_reward > 0 && (
                <span className="text-sm font-semibold text-accent">+{challenge.xp_reward} XP</span>
              )}
            </div>
            <CardTitle className="text-2xl">{challenge.title}</CardTitle>
            <CardDescription>{challenge.description}</CardDescription>
            {challenge.require_two_leader_eval && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4 p-3 bg-muted rounded-lg">
                <Shield className="h-4 w-4" />
                Este desafio requer avaliação de 2 líderes (1 Divisão + 1 Coordenação)
              </div>
            )}
          </CardHeader>
        </Card>

        {challenge.type === 'quiz' ? (
          quizCompleted ? (
            <Card>
              <CardHeader>
                <CardTitle>Quiz já concluído</CardTitle>
                <CardDescription>
                  Você já respondeu este quiz. Consulte o histórico no seu perfil.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate('/dashboard')} className="w-full">Voltar</Button>
              </CardContent>
            </Card>
          ) : (
            <QuizPlayer challengeId={challenge.id} />
          )
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{retryEventId ? 'Refazer Ação' : 'Submeter Ação'}</CardTitle>
              <CardDescription>
                {retryEventId 
                  ? 'Revise e melhore sua resposta com base no feedback recebido' 
                  : 'Descreva como você completou este desafio'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="description">Descrição da Ação *</Label>
                <Textarea
                  id="description"
                  placeholder="Descreva detalhadamente a ação realizada, contexto, resultados e aprendizados... (mínimo 50 caracteres)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {description.length}/50 caracteres mínimos
                </p>
              </div>

              {challenge.evidence_required && (
                <div>
                  <Label htmlFor="evidence">Evidências (URLs)</Label>
                  <Input
                    id="evidence"
                    placeholder="https://exemplo.com/foto.jpg"
                    onChange={(e) => {
                      const urls = e.target.value.split(',').map(u => u.trim()).filter(u => u);
                      setEvidenceUrls(urls);
                    }}
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Separe múltiplas URLs com vírgula
                  </p>
                </div>
              )}

              <Button 
                onClick={handleSubmit} 
                disabled={submitting || description.length < 50}
                className="w-full"
              >
                {submitting ? 'Submetendo...' : retryEventId ? 'Submeter Refação' : 'Submeter Ação'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ChallengeDetail;
