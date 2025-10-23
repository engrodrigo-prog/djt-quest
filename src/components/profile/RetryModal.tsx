import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';

interface RetryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  challengeTitle: string;
  retryCount: number;
  feedback?: {
    rating: number;
    feedback_construtivo: string | null;
  };
}

export const RetryModal = ({ isOpen, onClose, onConfirm, challengeTitle, retryCount, feedback }: RetryModalProps) => {
  const getRetryPenalty = () => {
    switch (retryCount + 1) {
      case 1: return '80%';
      case 2: return '60%';
      default: return '40%';
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            <AlertDialogTitle>Refazer Desafio</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-left">
              <div>
                <p className="font-semibold text-foreground mb-1">
                  Você está prestes a refazer:
                </p>
                <p className="text-sm font-medium text-foreground">{challengeTitle}</p>
              </div>

              {feedback && feedback.feedback_construtivo && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-900">
                  <p className="text-xs font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
                    Revise o feedback recebido:
                  </p>
                  <p className="text-xs text-yellow-800 dark:text-yellow-200">
                    {feedback.feedback_construtivo}
                  </p>
                </div>
              )}

              <div className="p-3 bg-muted rounded-lg space-y-2">
                <p className="text-xs font-semibold">Importante sobre pontuação:</p>
                <ul className="text-xs space-y-1 list-disc list-inside text-muted-foreground">
                  <li>Esta será sua <strong className="text-foreground">tentativa #{retryCount + 1}</strong></li>
                  <li>Você receberá <Badge variant="secondary" className="text-xs">{getRetryPenalty()}</Badge> dos pontos máximos</li>
                  <li>Os pontos anteriores não serão removidos</li>
                  <li>Use o feedback para melhorar sua submissão</li>
                </ul>
              </div>

              <p className="text-sm text-foreground">
                Ao refazer, você terá a oportunidade de demonstrar seu aprendizado e conquistar mais pontos!
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Continuar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};