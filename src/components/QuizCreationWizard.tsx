import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { QuizQuestionForm } from './QuizQuestionForm';
import { QuizQuestionsList } from './QuizQuestionsList';

const quizSchema = z.object({
  title: z.string().min(3, "Título deve ter no mínimo 3 caracteres"),
  description: z.string().min(10, "Descrição deve ter no mínimo 10 caracteres"),
  xp_reward: z.coerce.number().min(1, "XP deve ser maior que 0"),
});

type QuizFormData = z.infer<typeof quizSchema>;

export function QuizCreationWizard() {
  const [quizId, setQuizId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { register, handleSubmit, formState: { errors } } = useForm<QuizFormData>({
    resolver: zodResolver(quizSchema),
    defaultValues: {
      title: '',
      description: '',
      xp_reward: 100,
    },
  });

  const onSubmit = async (data: QuizFormData) => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      const { data: challenge, error } = await supabase
        .from('challenges')
        .insert({
          title: data.title,
          description: data.description,
          type: 'quiz',
          xp_reward: data.xp_reward,
          evidence_required: false,
          require_two_leader_eval: false,
        })
        .select()
        .single();

      if (error) throw error;

      setQuizId(challenge.id);
      toast.success("Quiz criado! Agora adicione as perguntas.");
    } catch (error) {
      console.error("Error creating quiz:", error);
      toast.error("Erro ao criar quiz");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuestionAdded = () => {
    setRefreshKey(prev => prev + 1);
  };

  if (!quizId) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-6 w-6 text-primary" />
            Criar Quiz de Conhecimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Título do Quiz</Label>
              <Input
                id="title"
                {...register('title')}
                placeholder="Ex: Conhecimentos de Segurança"
              />
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                {...register('description')}
                placeholder="Descreva o objetivo do quiz..."
                rows={3}
              />
              {errors.description && (
                <p className="text-sm text-destructive">{errors.description.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="xp_reward">XP por Quiz Completo</Label>
              <Input
                id="xp_reward"
                type="number"
                {...register('xp_reward')}
                placeholder="100"
              />
              {errors.xp_reward && (
                <p className="text-sm text-destructive">{errors.xp_reward.message}</p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full" size="lg">
              {isSubmitting ? "Criando..." : "Criar Quiz e Adicionar Perguntas"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-6 w-6 text-primary" />
            Adicionar Perguntas ao Quiz
          </CardTitle>
        </CardHeader>
      </Card>

      <QuizQuestionsList key={refreshKey} challengeId={quizId} onUpdate={handleQuestionAdded} />
      
      <QuizQuestionForm challengeId={quizId} onQuestionAdded={handleQuestionAdded} />
    </div>
  );
}