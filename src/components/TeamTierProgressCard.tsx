import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TierBadge } from '@/components/TierBadge';
import { Users, TrendingUp } from 'lucide-react';
import { calculateTierFromXp, getNextTierInfo } from '@/lib/utils/tierCalculations';

interface TeamTierProgressCardProps {
  avgXp: number;
  totalMembers: number;
  totalXp: number;
}

export const TeamTierProgressCard = ({ avgXp, totalMembers, totalXp }: TeamTierProgressCardProps) => {
  const avgTierCode = calculateTierFromXp(avgXp, 'EX');
  const nextTierInfo = getNextTierInfo(avgXp, avgTierCode);

  return (
    <Card className="p-6 bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Progressão da Equipe
        </h3>
        <TierBadge tierCode={avgTierCode} size="lg" />
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">XP Médio da Equipe</span>
            <span className="font-semibold">
              {Math.floor(avgXp).toLocaleString()} XP
            </span>
          </div>
          
          {nextTierInfo.nextTier && (
            <>
              <Progress value={nextTierInfo.progress} className="h-3 mb-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progresso para {nextTierInfo.nextTierName}</span>
                <span>{Math.round(nextTierInfo.progress)}%</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Faltam <span className="font-semibold text-foreground">{nextTierInfo.xpNeeded.toLocaleString()} XP</span> para o próximo nível
              </p>
            </>
          )}

          {!nextTierInfo.nextTier && (
            <div className="text-sm text-primary font-semibold mt-2 flex items-center gap-2">
              🏆 Nível máximo alcançado pela equipe!
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border/50">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{totalMembers} colaboradores</span>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Total acumulado: </span>
            <span className="font-semibold text-primary">{totalXp.toLocaleString()} XP</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
