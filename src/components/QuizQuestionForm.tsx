import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { quizQuestionSchema, difficultyLevels, type QuizQuestionFormData, type DifficultyLevel } from "@/lib/validations/quiz";
import { apiFetch } from "@/lib/api";

interface QuizQuestionFormProps {
  challengeId: string;
  onQuestionAdded: () => void;
}

export function QuizQuestionForm({ challengeId, onQuestionAdded }: QuizQuestionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>("basico");
  const MIN_WRONG_OPTIONS = 3;
  const MAX_OPTIONS = 5;

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<QuizQuestionFormData>({
    resolver: zodResolver(quizQuestionSchema),
    defaultValues: {
      question_text: "",
      difficulty_level: "basico",
      options: [
        { option_text: "", is_correct: true, explanation: "" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "options",
  });

  const options = watch("options");

  const createViaApi = async (payload: QuizQuestionFormData, token: string) => {
    const resp = await apiFetch('/api/studio-create-quiz-question', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        challengeId,
        question_text: payload.question_text,
        difficulty_level: payload.difficulty_level,
        options: payload.options,
      }),
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      throw new Error(json?.error || 'Falha ao criar pergunta');
    }
  };

  const createDirect = async (payload: QuizQuestionFormData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Não autenticado');

    const diffMap: Record<string, string> = { basico: 'basica', intermediario: 'intermediaria', avancado: 'avancada', especialista: 'especialista' };
    const { data: question, error: questionError } = await supabase
      .from('quiz_questions')
      .insert({
        challenge_id: challengeId,
        question_text: payload.question_text,
        difficulty_level: diffMap[String(payload.difficulty_level)] || 'basica',
        xp_value: difficultyLevels[payload.difficulty_level].xp,
        created_by: user.id,
      })
      .select()
      .single();

    if (questionError) throw questionError;

    const optionsToInsert = payload.options.map((opt) => ({
      question_id: question.id,
      option_text: opt.option_text,
      is_correct: opt.is_correct,
      explanation: opt.explanation || null,
    }));

    const { error: optionsError } = await supabase
      .from('quiz_options')
      .insert(optionsToInsert);

    if (optionsError) throw optionsError;
  };

  const ensureWrongOptions = async (payload: QuizQuestionFormData, token: string) => {
    const sanitized = payload.options
      .map((opt) => ({
        ...opt,
        option_text: opt.option_text.trim(),
        explanation: opt.explanation?.trim() || "",
      }))
      .filter((opt) => opt.is_correct || opt.option_text.length > 0);

    const correct = sanitized.find((opt) => opt.is_correct);
    if (!correct || correct.option_text.length < 5) {
      throw new Error("Preencha a alternativa correta (mínimo 5 caracteres).");
    }

    const wrongOptions = sanitized.filter((opt) => !opt.is_correct);
    if (wrongOptions.length >= MIN_WRONG_OPTIONS) {
      return { ...payload, options: sanitized.slice(0, MAX_OPTIONS) };
    }

    toast.info("Gerando alternativas erradas automaticamente...");
    const resp = await apiFetch('/api/ai-generate-wrongs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        question: payload.question_text,
        correct: correct.option_text,
        difficulty: payload.difficulty_level,
        language: 'pt-BR',
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error || "Falha ao gerar alternativas erradas");

    const aiCandidates = Array.isArray(json?.wrong) ? json.wrong : [];
    for (const candidate of aiCandidates) {
      if (wrongOptions.length >= MIN_WRONG_OPTIONS) break;
      const text = String(candidate?.text || "").trim();
      if (!text) continue;
      if (text.toLowerCase() === correct.option_text.toLowerCase()) continue;
      if (wrongOptions.some((opt) => opt.option_text.toLowerCase() === text.toLowerCase())) continue;
      wrongOptions.push({
        option_text: text,
        explanation: String(candidate?.explanation || "").trim(),
        is_correct: false,
      });
    }

    if (wrongOptions.length < MIN_WRONG_OPTIONS) {
      throw new Error("Não foi possível gerar alternativas erradas suficientes. Tente novamente adicionando ao menos uma manualmente.");
    }

    const finalOptions = [correct, ...wrongOptions].slice(0, MAX_OPTIONS);
    return { ...payload, options: finalOptions };
  };

  const onSubmit = async (data: QuizQuestionFormData) => {
    setIsSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Não autenticado');

      const payload = await ensureWrongOptions(data, token);
      try {
        await createViaApi(payload, token);
      } catch (apiError) {
        console.warn('API quiz creation failed, falling back to direct insert:', apiError);
        await createDirect(payload);
      }

      toast.success('Pergunta criada com sucesso!');
      reset({
        question_text: '',
        difficulty_level: 'basico',
        options: [
          { option_text: '', is_correct: true, explanation: '' },
        ],
      });
      setSelectedDifficulty('basico');
      onQuestionAdded();
    } catch (error: any) {
      console.error('Error creating question:', error);
      toast.error(error?.message || 'Erro ao criar pergunta');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCorrectChange = (index: number) => {
    const newOptions = options.map((opt, i) => ({
      ...opt,
      is_correct: i === index,
    }));
    reset({ ...watch(), options: newOptions });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova Pergunta</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Difficulty Level */}
          <div className="space-y-2">
            <Label>Dificuldade</Label>
            <Select
              value={selectedDifficulty}
              onValueChange={(value) => {
                setSelectedDifficulty(value as DifficultyLevel);
                reset({ ...watch(), difficulty_level: value as DifficultyLevel });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(difficultyLevels).map(([key, { label, xp }]) => (
                  <SelectItem key={key} value={key}>
                    {label} - {xp} XP
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.difficulty_level && (
              <p className="text-sm text-destructive">{errors.difficulty_level.message}</p>
            )}
          </div>

          {/* Question Text */}
          <div className="space-y-2">
            <Label htmlFor="question_text">Pergunta</Label>
            <Textarea
              id="question_text"
              {...register("question_text")}
              placeholder="Digite a pergunta..."
              rows={3}
            />
            {errors.question_text && (
              <p className="text-sm text-destructive">{errors.question_text.message}</p>
            )}
          </div>

          {/* Options */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Alternativas</Label>
                <p className="text-xs text-muted-foreground">
                  Você pode cadastrar apenas a correta; geramos as erradas automaticamente com IA.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ option_text: "", is_correct: false, explanation: "" })}
                disabled={fields.length >= 5}
              >
                <Plus className="h-4 w-4 mr-2" />
                Adicionar
              </Button>
            </div>

            <RadioGroup value={Math.max(0, options.findIndex((o) => o.is_correct)).toString()}>
              {fields.map((field, index) => (
                <Card key={field.id} className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <RadioGroupItem
                        value={index.toString()}
                        id={`correct-${index}`}
                        onClick={() => handleCorrectChange(index)}
                        className="mt-3"
                      />
                      <div className="flex-1 space-y-2">
                        <Label htmlFor={`correct-${index}`} className="text-sm text-muted-foreground">
                          Alternativa {String.fromCharCode(65 + index)}
                        </Label>
                        <Input
                          {...register(`options.${index}.option_text`)}
                          placeholder="Texto da alternativa..."
                        />
                        {errors.options?.[index]?.option_text && (
                          <p className="text-sm text-destructive">
                            {errors.options[index]?.option_text?.message}
                          </p>
                        )}
                      </div>
                      {fields.length > 1 && (!options[index]?.is_correct || options.filter((o) => o.is_correct).length > 1) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                          className="mt-6"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="ml-9">
                      <Textarea
                        {...register(`options.${index}.explanation`)}
                        placeholder="Explicação (opcional)..."
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </RadioGroup>

            {errors.options?.root && (
              <p className="text-sm text-destructive">{errors.options.root.message}</p>
            )}
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            <Save className="h-4 w-4 mr-2" />
            {isSubmitting ? "Salvando..." : "Salvar Pergunta"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
