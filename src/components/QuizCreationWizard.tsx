import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HelpCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { ChallengeForm } from './ChallengeForm';

export function QuizCreationWizard() {
  const [step, setStep] = useState<'info' | 'questions'>('info');
  const [quizId, setQuizId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-6 w-6 text-primary" />
            Criar Quiz de Conhecimento
          </CardTitle>
          <CardDescription>
            Sistema de perguntas e respostas com pontuação por acerto
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'info' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-background/50 border space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">1</span>
                  Informações do Quiz
                </h3>
                <p className="text-sm text-muted-foreground ml-8">
                  Configure título, descrição e público-alvo do quiz
                </p>
              </div>
              
              <div className="p-4 rounded-lg bg-muted/50 border border-dashed space-y-2">
                <h3 className="font-semibold flex items-center gap-2 text-muted-foreground">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-sm">2</span>
                  Adicionar Perguntas
                </h3>
                <p className="text-sm text-muted-foreground ml-8">
                  Crie perguntas com alternativas e defina a pontuação
                </p>
              </div>

              <Button 
                onClick={() => setStep('questions')} 
                className="w-full"
                size="lg"
              >
                Começar <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {step === 'questions' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium">Configure as informações do quiz abaixo (selecione tipo "quiz")</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Formulário de Challenge sempre visível */}
      <ChallengeForm />
    </div>
  );
}