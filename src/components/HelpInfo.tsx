import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/contexts/I18nContext'

type HelpKind = 'quiz' | 'challenge' | 'forum'

export function HelpInfo({ kind = 'challenge' as HelpKind }: { kind?: HelpKind }) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()

  const render = () => {
    if (kind === 'quiz') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>{t("helpInfo.quiz.title")}</DialogTitle>
            <DialogDescription className="sr-only">Ajuda e instruções do quiz</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>• {t("helpInfo.quiz.b1")}</p>
            <p>• {t("helpInfo.quiz.b2")}</p>
            <p>• {t("helpInfo.quiz.b3")}</p>
            <p>• {t("helpInfo.quiz.b4")}</p>
          </div>
        </>
      )
    }
    if (kind === 'forum') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>{t("helpInfo.forum.title")}</DialogTitle>
            <DialogDescription className="sr-only">Ajuda e instruções do fórum</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>• {t("helpInfo.forum.b1")}</p>
            <p>• {t("helpInfo.forum.b2")}</p>
            <p>• {t("helpInfo.forum.b3")}</p>
            <p>• {t("helpInfo.forum.b4")}</p>
          </div>
        </>
      )
    }
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("helpInfo.challenge.title")}</DialogTitle>
          <DialogDescription className="sr-only">Ajuda e instruções do desafio</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>• {t("helpInfo.challenge.b1")}</p>
          <p>• {t("helpInfo.challenge.b2")}</p>
          <p>• {t("helpInfo.challenge.b3")}</p>
          <p>• {t("helpInfo.challenge.b4")}</p>
        </div>
      </>
    )
  }

  return (
    <>
      <button className="fixed right-4 bottom-24 md:bottom-28 z-40 inline-flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground shadow hover:opacity-90" onClick={() => setOpen(true)} aria-label={t("helpInfo.ariaLabel")}>
        <HelpCircle className="h-5 w-5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {render()}
        </DialogContent>
      </Dialog>
    </>
  )
}
