import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, Target, Award, AlertCircle } from 'lucide-react';

interface LearningStats {
  totalEvaluated: number;
  averageRating: number;
  lowScoreCount: number;
  improvementOpportunities: number;
  topStrength: string | null;
  topWeakness: string | null;
}

interface LearningDashboardProps {
  stats: LearningStats;
}

export const LearningDashboard = ({ stats }: LearningDashboardProps) => {
  const { totalEvaluated, averageRating, lowScoreCount, improvementOpportunities, topStrength, topWeakness } = stats;

  const getRatingColor = (rating: number) => {
    if (rating >= 4.0) return 'text-green-600';
    if (rating >= 3.0) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getRatingLabel = (rating: number) => {
    if (rating >= 4.5) return 'Excelente';
    if (rating >= 4.0) return 'Ótimo';
    if (rating >= 3.0) return 'Bom';
    if (rating >= 2.0) return 'Precisa Melhorar';
    return 'Atenção Necessária';
  };

  return (
    <div className="space-y-4">
      {/* Performance Summary */}
      <Card className="bg-gradient-to-br from-primary/5 to-secondary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Resumo de Desempenho
          </CardTitle>
          <CardDescription>Visão geral do seu aprendizado</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-background rounded-lg">
              <p className="text-3xl font-bold text-primary">{totalEvaluated}</p>
              <p className="text-xs text-muted-foreground mt-1">Ações Avaliadas</p>
            </div>
            <div className="text-center p-4 bg-background rounded-lg">
              <p className={`text-3xl font-bold ${getRatingColor(averageRating)}`}>
                {averageRating.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Média Geral</p>
              <Badge variant="outline" className="mt-1 text-xs">
                {getRatingLabel(averageRating)}
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Progresso para Excelência</span>
              <span className="font-semibold">{averageRating.toFixed(1)} / 5.0</span>
            </div>
            <Progress value={averageRating * 20} className="h-3" />
          </div>
        </CardContent>
      </Card>

      {/* Opportunities Card */}
      {improvementOpportunities > 0 && (
        <Card className="border-orange-200 dark:border-orange-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <AlertCircle className="h-5 w-5" />
              Oportunidades de Melhoria
            </CardTitle>
            <CardDescription>
              Ações que podem ser refeitas para melhorar o aprendizado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
              <div>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {improvementOpportunities}
                </p>
                <p className="text-sm text-orange-800 dark:text-orange-200">
                  {improvementOpportunities === 1 ? 'desafio disponível' : 'desafios disponíveis'} para refazer
                </p>
              </div>
              <Target className="h-12 w-12 text-orange-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Strengths & Weaknesses */}
      {(topStrength || topWeakness) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5" />
              Análise de Competências
            </CardTitle>
            <CardDescription>
              Seus pontos fortes e áreas de desenvolvimento
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {topStrength && (
              <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-900">
                <p className="text-xs font-semibold text-green-900 dark:text-green-100 mb-1">
                  🏆 Ponto Forte
                </p>
                <p className="text-sm text-green-800 dark:text-green-200">
                  {topStrength}
                </p>
              </div>
            )}
            
            {topWeakness && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900">
                <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">
                  💡 Foco de Desenvolvimento
                </p>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {topWeakness}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Motivational Message */}
      {lowScoreCount === 0 && totalEvaluated > 0 && (
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-200 dark:border-green-900">
          <CardContent className="py-6 text-center">
            <p className="text-lg font-semibold text-green-900 dark:text-green-100">
              🎉 Parabéns! Continue assim!
            </p>
            <p className="text-sm text-green-800 dark:text-green-200 mt-1">
              Todas as suas ações estão com ótima avaliação
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};