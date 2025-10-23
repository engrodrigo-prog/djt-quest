import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ThumbsUp, Lightbulb, RefreshCw, CheckCircle, XCircle } from 'lucide-react';

interface ActionReviewCardProps {
  event: {
    id: string;
    created_at: string;
    status: string;
    points_calculated: number;
    retry_count: number;
    challenge: {
      title: string;
      type: string;
      xp_reward: number;
    };
    evaluation?: {
      rating: number;
      feedback_positivo: string | null;
      feedback_construtivo: string | null;
      scores: {
        clareza?: number;
        qualidade?: number;
        impacto?: number;
        alinhamento?: number;
        evidencias?: number;
      };
    };
  };
  onRetry?: (eventId: string, challengeId: string) => void;
}

export const ActionReviewCard = ({ event, onRetry }: ActionReviewCardProps) => {
  const { evaluation } = event;
  const hasEvaluation = evaluation && event.status !== 'submitted';
  
  const getStatusInfo = () => {
    switch (event.status) {
      case 'approved':
        return { label: 'Aprovado', icon: CheckCircle, color: 'text-green-600', variant: 'default' as const };
      case 'rejected':
        return { label: 'Rejeitado', icon: XCircle, color: 'text-red-600', variant: 'destructive' as const };
      case 'submitted':
        return { label: 'Em Avaliação', icon: RefreshCw, color: 'text-yellow-600', variant: 'secondary' as const };
      case 'retry_in_progress':
        return { label: 'Refazendo', icon: RefreshCw, color: 'text-blue-600', variant: 'outline' as const };
      default:
        return { label: event.status, icon: RefreshCw, color: 'text-muted-foreground', variant: 'outline' as const };
    }
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;
  const shouldShowRetryButton = hasEvaluation && evaluation.rating < 4.0 && event.status !== 'retry_in_progress';

  const criteriaLabels: Record<string, string> = {
    clareza: 'Clareza',
    qualidade: 'Qualidade',
    impacto: 'Impacto',
    alinhamento: 'Alinhamento',
    evidencias: 'Evidências'
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{event.challenge.type}</Badge>
            <Badge variant={statusInfo.variant}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusInfo.label}
            </Badge>
            {event.retry_count > 0 && (
              <Badge variant="secondary">
                <RefreshCw className="h-3 w-3 mr-1" />
                Tentativa {event.retry_count + 1}
              </Badge>
            )}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-accent">
              +{event.points_calculated || event.challenge.xp_reward} XP
            </p>
            {event.retry_count > 0 && (
              <p className="text-xs text-muted-foreground">
                ({event.retry_count === 1 ? '80%' : event.retry_count === 2 ? '60%' : '40%'} dos pontos)
              </p>
            )}
          </div>
        </div>
        <CardTitle className="text-base">{event.challenge.title}</CardTitle>
        <CardDescription className="text-xs">
          Submetido em {new Date(event.created_at).toLocaleDateString('pt-BR', { 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </CardDescription>
      </CardHeader>

      {hasEvaluation && (
        <CardContent className="space-y-4 border-t pt-4">
          {/* Rating Summary */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <span className="font-semibold">Avaliação Geral</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{evaluation.rating.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">/5.0</span>
            </div>
          </div>

          {/* Rubrics */}
          {evaluation.scores && Object.keys(evaluation.scores).length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Critérios Avaliados</h4>
              {Object.entries(evaluation.scores).map(([key, value]) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{criteriaLabels[key] || key}</span>
                    <span className="font-semibold">{value}/5.0</span>
                  </div>
                  <Progress value={value * 20} className="h-2" />
                </div>
              ))}
            </div>
          )}

          {/* Positive Feedback */}
          {evaluation.feedback_positivo && (
            <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-900">
              <div className="flex items-start gap-2">
                <ThumbsUp className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-sm text-green-900 dark:text-green-100 mb-1">
                    Pontos Positivos
                  </p>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    {evaluation.feedback_positivo}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Constructive Feedback */}
          {evaluation.feedback_construtivo && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-900">
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-sm text-yellow-900 dark:text-yellow-100 mb-1">
                    Oportunidades de Melhoria
                  </p>
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    {evaluation.feedback_construtivo}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Retry Button */}
          {shouldShowRetryButton && onRetry && (
            <div className="pt-2">
              {evaluation.rating < 3.0 ? (
                <div className="p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg mb-3">
                  <p className="text-sm text-orange-900 dark:text-orange-100">
                    💡 Considere refazer este desafio para demonstrar seu aprendizado e melhorar sua pontuação!
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg mb-3">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    Você pode refazer este desafio para praticar e reforçar o conhecimento!
                  </p>
                </div>
              )}
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => onRetry(event.id, event.challenge.title)}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refazer Desafio
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};