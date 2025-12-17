import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { QuizQuestionForm } from './QuizQuestionForm';
import { QuizQuestionsList } from './QuizQuestionsList';
import { AiQuizGenerator } from './AiQuizGenerator';
import { apiFetch } from '@/lib/api';

const quizSchema = z.object({
  title: z.string().min(3, "Título deve ter no mínimo 3 caracteres"),
  description: z
    .string()
    .trim()
    .default('')
    .refine((val) => val.length === 0 || val.length >= 10, {
      message: "Descrição deve ter no mínimo 10 caracteres quando preenchida",
    }),
  xp_reward: z.coerce.number().min(1, "XP deve ser maior que 0"),
  quiz_specialties: z.array(z.string()).optional(),
  chas_dimension: z.enum(['C','H','A','S']).default('C'),
});

type QuizFormData = z.infer<typeof quizSchema>;

export function QuizCreationWizard() {
  const [quizId, setQuizId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingForCuration, setIsSubmittingForCuration] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const navigate = useNavigate();

  const { register, handleSubmit, formState: { errors }, setValue } = useForm<QuizFormData>({
    resolver: zodResolver(quizSchema),
    defaultValues: {
      title: '',
      description: '',
      xp_reward: 100,
      quiz_specialties: [],
      chas_dimension: 'C',
    },
  });

  // Prefill from Forum Insights draft (if any)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('studio_compendium_draft');
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || draft.kind !== 'quiz') return;
      if (draft.title) setValue('title', String(draft.title).replace(/^Quiz:\s*/i,'').trim());
      if (draft.summary) setValue('description', String(draft.summary));
      if (Array.isArray(draft.specialties)) setValue('quiz_specialties', draft.specialties);
      if (draft.chas && ['C','H','A','S'].includes(draft.chas)) setValue('chas_dimension', draft.chas);
      // Default XP header suggestion (can be adjusted by user)
      setValue('xp_reward', 20);
      // Clear so it won't prefill again unexpectedly
      localStorage.removeItem('studio_compendium_draft');
    } catch {
      void 0;
    }
  }, [setValue]);

  const onSubmit = async (data: QuizFormData) => {
    setIsSubmitting(true);
    try {
      // Prefer backend flow (RBAC + owner_id + workflow status)
      try {
        const resp = await apiFetch("/api/admin?handler=curation-create-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.title,
            description: data.description,
            xp_reward: data.xp_reward,
            quiz_specialties: data.quiz_specialties || null,
            chas_dimension: data.chas_dimension || "C",
          }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(String(json?.error || "Erro ao criar quiz"));
        const created = (json as any)?.quiz;
        if (!created?.id) throw new Error("Resposta inesperada ao criar quiz");
        setQuizId(created.id);
        toast.success("Quiz criado! Agora adicione as perguntas.");
        return;
      } catch (e) {
        console.warn("curation-create-quiz failed; falling back to direct insert", e);
      }

      // Fallback (compat): create directly via client if backend handler not available
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      let challenge = null as any;
      const baseInsert: any = {
        title: data.title,
        description: data.description,
        type: "quiz",
        xp_reward: data.xp_reward,
        evidence_required: false,
        require_two_leader_eval: false,
      };
      const withWorkflow: any = {
        ...baseInsert,
        owner_id: user.id,
        created_by: user.id,
        quiz_workflow_status: "DRAFT",
        quiz_specialties: data.quiz_specialties || null,
        chas_dimension: data.chas_dimension || "C",
      };

      const { data: ch1, error: err1 } = await supabase.from("challenges").insert(withWorkflow).select().single();
      if (err1) {
        const { data: ch2, error: err2 } = await supabase.from("challenges").insert(baseInsert).select().single();
        if (err2) throw err2;
        challenge = ch2;
      } else {
        challenge = ch1;
      }

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

  const submitForCuration = async () => {
    if (!quizId) return;
    setIsSubmittingForCuration(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Não autenticado');
      const resp = await apiFetch('/api/admin?handler=curation-submit-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ challengeId: quizId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao submeter');
      toast.success('Quiz submetido para curadoria');
      navigate('/studio/curadoria');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao submeter');
    } finally {
      setIsSubmittingForCuration(false);
    }
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
              <div className="flex items-center justify-between">
                <Label htmlFor="description">Descrição (opcional)</Label>
                <span className="text-xs text-muted-foreground">Use para contextualizar o quiz</span>
              </div>
              <Textarea
                id="description"
                {...register('description')}
                placeholder="Descreva o objetivo do quiz..."
                rows={3}
              />
              {errors.description && (
                <p className="text-sm text-destructive">{errors.description.message}</p>
              )}
              {!errors.description && (
                <p className="text-xs text-muted-foreground">
                  Deixe em branco ou use pelo menos 10 caracteres.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>XP por Quiz (seleção rápida)</Label>
              <Select onValueChange={(v:any)=> setValue('xp_reward', Number(v), { shouldValidate: true, shouldDirty: true })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione 5 / 10 / 20 / 50" />
                </SelectTrigger>
                <SelectContent>
                  {[5,10,20,50].map(x => (<SelectItem key={x} value={String(x)}>{x} XP</SelectItem>))}
                </SelectContent>
              </Select>
              <Input id="xp_reward" type="number" {...register('xp_reward')} placeholder="5" className="sr-only" />
              {errors.xp_reward && (<p className="text-sm text-destructive">{errors.xp_reward.message}</p>)}
              <p className="text-xs text-muted-foreground">XP por questão é definido pelo nível (5/10/20/50). Este valor resume o total do quiz ou bônus.</p>
            </div>

            <div className="space-y-2">
              <Label>Especialidades Relacionadas</Label>
              <div className="grid sm:grid-cols-2 gap-2 text-sm">
                {[
                  { id: 'seguranca', label: 'Segurança' },
                  { id: 'protecao_automacao', label: 'Proteção & Automação' },
                  { id: 'telecom', label: 'Telecom' },
                  { id: 'equipamentos_manobras', label: 'Equipamentos & Manobras' },
                  { id: 'instrumentacao', label: 'Instrumentação' },
                  { id: 'gerais', label: 'Gerais' },
                ].map(s => (
                  <label key={s.id} className="inline-flex items-center gap-2">
                    <input type="checkbox" value={s.id} {...register('quiz_specialties')} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Essas tags ajudam a classificar e buscar quizzes por domínio.</p>
            </div>

            <div className="space-y-2">
              <Label>Dimensão CHAS</Label>
              <select className="w-full h-9 rounded-md bg-transparent border px-2" {...register('chas_dimension')}>
                <option value="C">C — Conhecimento</option>
                <option value="H">H — Habilidade</option>
                <option value="A">A — Atitude</option>
                <option value="S">S — Segurança</option>
              </select>
              {errors.chas_dimension && (
                <p className="text-sm text-destructive">Dimensão inválida</p>
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
          <CardDescription className="flex items-center justify-between gap-2 flex-wrap">
            <span>Quando terminar, submeta para curadoria.</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => navigate('/studio/curadoria')}>
                Abrir Hub de Curadoria
              </Button>
              <Button onClick={submitForCuration} disabled={isSubmittingForCuration}>
                {isSubmittingForCuration ? 'Submetendo…' : 'Submeter'}
              </Button>
            </div>
          </CardDescription>
        </CardHeader>
      </Card>

      <QuizQuestionsList key={refreshKey} challengeId={quizId} onUpdate={handleQuestionAdded} />
      
      <QuizQuestionForm challengeId={quizId} onQuestionAdded={handleQuestionAdded} />

      <Card className="border-purple-500/30 bg-purple-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-purple-400" />
            Quiz Especial • Milhão (IA)
          </CardTitle>
          <CardDescription>
            Use IA para gerar perguntas especiais ou um Quiz do Milhão completo (10 níveis) diretamente para este quiz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AiQuizGenerator defaultChallengeId={quizId} />
        </CardContent>
      </Card>
    </div>
  );
}
