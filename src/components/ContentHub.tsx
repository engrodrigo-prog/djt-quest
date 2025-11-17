import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Target, HelpCircle, MessageSquare } from 'lucide-react'

export function ContentHub({ onOpen }: { onOpen: (id: 'campaigns' | 'campaigns-manage' | 'quiz' | 'quiz-manage' | 'forums' | 'forums-manage') => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-blue-50 mb-1">Conteúdos</h2>
        <p className="text-blue-100/80">Gerencie campanhas, quizzes e fóruns (com dinâmicas de desafio integradas às campanhas) em um só lugar</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">Campanhas</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => onOpen('campaigns')} className="w-full">Criar Campanha</Button>
            <Button variant="outline" onClick={() => onOpen('campaigns-manage')} className="w-full">Gerenciar Campanhas</Button>
          </CardContent>
        </Card>

        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">Quizzes</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => onOpen('quiz')} className="w-full">Criar Quiz</Button>
            <Button variant="outline" onClick={() => onOpen('quiz-manage')} className="w-full">Gerenciar Quizzes</Button>
          </CardContent>
        </Card>

        <Card className="border-cyan-800/40 bg-white/5 hover:-translate-y-1 transition">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <CardTitle className="text-blue-50">Fóruns</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => onOpen('forums')} className="w-full">Criar Fórum</Button>
            <Button variant="outline" onClick={() => onOpen('forums-manage')} className="w-full">Gerenciar Fóruns</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
