import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Target, Zap, HelpCircle } from 'lucide-react'

export function ContentHub({ onOpen }: { onOpen: (id: 'campaigns' | 'challenges' | 'quiz') => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-blue-50 mb-1">Conteúdos</h2>
        <p className="text-blue-100/80">Gerencie campanhas, desafios e quizzes em um só lugar</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">Campanhas</CardTitle>
            </div>
            <CardDescription className="text-blue-100/80">Criar e gerenciar campanhas temáticas</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => onOpen('campaigns')} className="w-full">Abrir Campanhas</Button>
          </CardContent>
        </Card>

        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">Desafios</CardTitle>
            </div>
            <CardDescription className="text-blue-100/80">Criar e moderar desafios</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => onOpen('challenges')} className="w-full">Abrir Desafios</Button>
          </CardContent>
        </Card>

        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">Quizzes</CardTitle>
            </div>
            <CardDescription className="text-blue-100/80">Criar quizzes (vinculados ou independentes)</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => onOpen('quiz')} className="w-full">Abrir Quizzes</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
