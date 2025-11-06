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

interface QuizQuestionFormProps {
  challengeId: string;
  onQuestionAdded: () => void;
}

export function QuizQuestionForm({ challengeId, onQuestionAdded }: QuizQuestionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>("basica");

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
      difficulty_level: "basica",
      options: [
        { option_text: "", is_correct: true, explanation: "" },
        { option_text: "", is_correct: false, explanation: "" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "options",
  });

  const options = watch("options");

  const createViaApi = async (payload: QuizQuestionFormData) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Não autenticado');

    const resp = await fetch('/api/studio-create-quiz-question', {
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

    const { data: question, error: questionError } = await supabase
      .from('quiz_questions')
      .insert({
        challenge_id: challengeId,
        question_text: payload.question_text,
        difficulty_level: payload.difficulty_level,
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

  const onSubmit = async (data: QuizQuestionFormData) => {
    setIsSubmitting(true);
    try {
      try {
        await createViaApi(data);
      } catch (apiError) {
        console.warn('API quiz creation failed, falling back to direct insert:', apiError);
        await createDirect(data);
      }

      toast.success('Pergunta criada com sucesso!');
      reset({
        question_text: '',
        difficulty_level: 'basica',
        options: [
          { option_text: '', is_correct: true, explanation: '' },
          { option_text: '', is_correct: false, explanation: '' },
        ],
      });
      setSelectedDifficulty('basica');
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
              <Label>Alternativas</Label>
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

            <RadioGroup value={options.findIndex((o) => o.is_correct).toString()}>
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
                      {fields.length > 2 && (
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
