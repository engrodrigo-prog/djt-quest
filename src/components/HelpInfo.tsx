import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type HelpKind = 'quiz' | 'challenge' | 'forum'

export function HelpInfo({ kind = 'challenge' as HelpKind }: { kind?: HelpKind }) {
  const [open, setOpen] = useState(false)

  const render = () => {
    if (kind === 'quiz') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Como funciona a pontuação (Quiz)</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>• 1 tentativa por usuário (sem retake). Líderes não acumulam XP de quiz.</p>
            <p>• Dificuldade da questão define o XP por acerto: Básico 5 • Intermediário 10 • Avançado 20 • Especialista 40.</p>
            <p>• O total de XP do quiz é a soma dos acertos.</p>
            <p>• Opcional: bônus mensal de engajamento do fórum (até 20%) pode aumentar seu XP do mês, se habilitado no Studio.</p>
          </div>
        </>
      )
    }
    if (kind === 'forum') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Como funciona a pontuação (Fórum)</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>• Pontos de engajamento são computados mensalmente (quantidade + qualidade via IA).</p>
            <p>• Top 10 do mês podem receber bônus entre 5% e 20% sobre o XP mensal (quizzes + ações), se habilitado no Studio.</p>
            <p>• Conteúdos com imagens/cases e áudio transcrito enriquecem o aprendizado e aumentam a qualidade.</p>
            <p>• Líderes podem fechar temas e gerar compêndios, quizzes e desafios a partir das discussões.</p>
          </div>
        </>
      )
    }
    return (
      <>
        <DialogHeader>
          <DialogTitle>Como funciona a pontuação (Ações)</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>• Ações são avaliadas por 3 avaliadores (líder imediato, líder de divisão e gerente).</p>
          <p>• Nota final = média das 3 avaliações; os pontos aplicam sobre o XP do desafio e modificadores da equipe.</p>
          <p>• Para evitar duplicidade, informe data, local e nota SAP (quando aplicável).</p>
          <p>• Mídias (imagens/áudio organizado) enriquecem a avaliação e registro.</p>
        </div>
      </>
    )
  }

  return (
    <>
      <button className="fixed right-4 bottom-24 md:bottom-28 z-40 inline-flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground shadow hover:opacity-90" onClick={() => setOpen(true)} aria-label="Ajuda de pontuação">
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

