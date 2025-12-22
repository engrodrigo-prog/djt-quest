import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { TierBadge } from '@/components/TierBadge';
import { getTierInfo, getNextTierLevel, canRequestTierProgression, getNextTierPrefix } from '@/lib/constants/tiers';
import { ArrowUp, Lock } from 'lucide-react';
import { getActiveLocale } from '@/lib/i18n/activeLocale';

interface TierProgressCardProps {
  tierCode: string;
  xp: number;
  cooldownUntil?: string | null;
  onRequestProgression?: () => void;
}

export const TierProgressCard = ({ 
  tierCode, 
  xp, 
  cooldownUntil,
  onRequestProgression 
}: TierProgressCardProps) => {
  const info = getTierInfo(tierCode);
  const nextLevel = getNextTierLevel(tierCode, xp);
  const canProgress = canRequestTierProgression(tierCode);
  const isCooldown = cooldownUntil && new Date(cooldownUntil) > new Date();
  
  if (!info) return null;

  const progressPercent = ((xp - info.xpMin) / (info.xpMax - info.xpMin)) * 100;
  const nextTierPrefix = getNextTierPrefix(info.prefix);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Seu Nível Atual</span>
          <TierBadge tierCode={tierCode} size="lg" />
        </CardTitle>
        <CardDescription>
          Patamar {info.tier} • {xp} XP acumulados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isCooldown && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-2">
            <Lock className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Cooldown Ativo</p>
              <p className="text-sm text-destructive/80">
                Você foi rebaixado por incidente de segurança. 
                Progressão bloqueada até {new Date(cooldownUntil).toLocaleDateString(getActiveLocale())}.
              </p>
            </div>
          </div>
        )}

        {nextLevel && !canProgress && (
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span>Progresso para {nextLevel.name}</span>
              <span className="font-semibold">{nextLevel.xpNeeded} XP restantes</span>
            </div>
            <Progress value={progressPercent} className="h-3" />
          </div>
        )}

        {canProgress && nextTierPrefix && (
          <div className="p-4 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg border-2 border-primary/20">
            <h4 className="font-bold text-lg mb-2">🎯 Pronto para Evoluir!</h4>
            <p className="text-sm mb-3">
              Você atingiu o nível máximo do patamar <strong>{info.tier}</strong>. 
              Solicite progressão para o patamar <strong>{nextTierPrefix === 'FO' ? 'Formador' : 'Guardião'}</strong>!
            </p>
            <Button 
              onClick={onRequestProgression}
              className="w-full"
              disabled={isCooldown}
            >
              <ArrowUp className="mr-2 h-4 w-4" />
              Solicitar Progressão de Patamar
            </Button>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Seu coordenador criará um desafio especial para você
            </p>
          </div>
        )}

        {!canProgress && !nextLevel && (
          <div className="text-center p-4 bg-muted rounded-lg">
            <p className="font-bold">🏆 Nível Máximo Atingido!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Você está no topo do patamar {info.tier}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
