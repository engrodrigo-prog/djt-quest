import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { gameTips } from '@/content/game-tips';

export function TipDialogButton({
  tipId,
  ariaLabel,
  className = '',
}: {
  tipId: keyof typeof gameTips;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const title = gameTips[tipId]?.title || 'Sobre esta tela';
  const body =
    gameTips[tipId]?.body ||
    'Dica ainda não cadastrada. Atualize `src/content/game-tips.ts` para descrever esta tela.';

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel || `Entenda: ${title}`}
        className={
          className ||
          'inline-flex items-center justify-center rounded-full border border-border bg-muted/60 p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
        }
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <AlertCircle className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="whitespace-pre-line text-sm">{body}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}

