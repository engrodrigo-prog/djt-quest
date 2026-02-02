import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, Save, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { quizQuestionSchema, difficultyLevels, type QuizQuestionFormData, type DifficultyLevel } from "@/lib/validations/quiz";
import { apiFetch } from "@/lib/api";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { localeToOpenAiLanguageTag, localeToSpeechLanguage } from "@/lib/i18n/language";

interface QuizQuestionFormProps {
  challengeId: string;
  onQuestionAdded: () => void;
}

export function QuizQuestionForm({ challengeId, onQuestionAdded }: QuizQuestionFormProps) {
  const [mode, setMode] = useState<"quick" | "full">("quick");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>("basico");
  const TARGET_WRONG_OPTIONS = 3;
  const MAX_OPTIONS = 4;

  const [quizXpReward, setQuizXpReward] = useState<number | null>(null);
  const [quickQuestionText, setQuickQuestionText] = useState("");
  const [quickCorrectText, setQuickCorrectText] = useState("");
  const [quickExplanation, setQuickExplanation] = useState("");

  const xpToDifficulty = (xp: number): DifficultyLevel => {
    const n = Number(xp);
    if (n === 5) return "basico";
    if (n === 10) return "intermediario";
    if (n === 20) return "avancado";
    if (n === 50) return "especialista";
    return "intermediario";
  };

  const forcedDifficulty = useMemo<DifficultyLevel>(() => {
    const xp = Number(quizXpReward);
    if ([5, 10, 20, 50].includes(xp)) return xpToDifficulty(xp);
    return selectedDifficulty;
  }, [quizXpReward, selectedDifficulty]);

  const {
    register,
    handleSubmit,
    control,
    watch,
    getValues,
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("challenges").select("xp_reward").eq("id", challengeId).maybeSingle();
        const xp = Number((data as any)?.xp_reward);
        if (cancelled) return;
        setQuizXpReward(Number.isFinite(xp) ? xp : null);
        if ([5, 10, 20, 50].includes(xp)) {
          const d = xpToDifficulty(xp);
          setSelectedDifficulty(d);
          const current = getValues();
          reset({ ...current, difficulty_level: d });
        }
      } catch {
        if (!cancelled) setQuizXpReward(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [challengeId, getValues, reset]);

  const { fields, append, remove } = useFieldArray({
    control,
    name: "options",
  });

  const options = watch("options");

  const createViaApi = async (payload: QuizQuestionFormData, token: string) => {
    const resp = await apiFetch('/api/admin?handler=studio-create-quiz-question', {
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

  const shuffle = <T,>(arr: T[]) => [...arr].map((v) => ({ v, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.v);

  const submitQuick = async () => {
    if (isSubmitting) return;
    const q = String(quickQuestionText || "").trim();
    const correct = String(quickCorrectText || "").trim();
    const exp = String(quickExplanation || "").trim();
    if (q.length < 10) {
      toast.error("Pergunta deve ter no mínimo 10 caracteres.");
      return;
    }
    if (correct.length < 5) {
      toast.error("Resposta correta deve ter no mínimo 5 caracteres.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Não autenticado");

      const resp = await apiFetch("/api/ai?handler=generate-wrongs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: q,
          correct,
          difficulty: forcedDifficulty,
          language: localeToOpenAiLanguageTag(getActiveLocale()),
          count: TARGET_WRONG_OPTIONS,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao gerar alternativas erradas");
      const wrong = Array.isArray(json?.wrong) ? json.wrong : [];
      const wrongTexts = wrong
        .map((w: any) => ({ text: String(w?.text || "").trim(), explanation: String(w?.explanation || "").trim() }))
        .filter((w: any) => w.text && w.text.toLowerCase() !== correct.toLowerCase())
        .slice(0, TARGET_WRONG_OPTIONS);
      if (wrongTexts.length < TARGET_WRONG_OPTIONS) {
        throw new Error("Não foi possível gerar alternativas erradas suficientes. Tente novamente.");
      }

      const optionsPayload: QuizQuestionFormData["options"] = [
        { option_text: correct, is_correct: true, explanation: exp },
        ...wrongTexts.map((w: any) => ({ option_text: w.text, is_correct: false, explanation: w.explanation })),
      ];

      const payload: QuizQuestionFormData = {
        question_text: q,
        difficulty_level: forcedDifficulty,
        options: shuffle(optionsPayload),
      };

      await createViaApi(payload, token);

      toast.success("Pergunta criada com sucesso!");
      setQuickQuestionText("");
      setQuickCorrectText("");
      setQuickExplanation("");
      onQuestionAdded();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao criar pergunta");
    } finally {
      setIsSubmitting(false);
    }
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
    const missing = Math.max(0, TARGET_WRONG_OPTIONS - wrongOptions.length); // 3 erradas + 1 correta (total 4)
    if (missing <= 0) {
      return { ...payload, options: sanitized.slice(0, MAX_OPTIONS) };
    }

    toast.info(`Gerando ${missing} alternativas erradas...`);
    const resp = await apiFetch('/api/ai?handler=generate-wrongs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        question: payload.question_text,
        correct: correct.option_text,
        difficulty: payload.difficulty_level,
        language: localeToOpenAiLanguageTag(getActiveLocale()),
        count: missing,
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error || "Falha ao gerar alternativas erradas");

    const aiCandidates = Array.isArray(json?.wrong) ? json.wrong : [];
    for (const candidate of aiCandidates) {
      if (wrongOptions.length >= TARGET_WRONG_OPTIONS) break;
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

    if (wrongOptions.length < TARGET_WRONG_OPTIONS) {
      throw new Error("Não foi possível gerar alternativas erradas suficientes. Adicione mais algumas manualmente e tente novamente.");
    }

    const finalOptions = [correct, ...wrongOptions].slice(0, MAX_OPTIONS);
    return { ...payload, options: finalOptions };
  };

  // Geração sob demanda (botão) para completar até 5 alternativas
  const handleGenerateWrongsClick = async () => {
    try {
      const current = watch();
      const correct = current.options.find((o) => o.is_correct);
      if (!current.question_text || !correct) {
        toast.error('Preencha a pergunta e marque a alternativa correta antes.');
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Não autenticado');

      const sanitized = current.options
        .map((opt) => ({ ...opt, option_text: opt.option_text.trim(), explanation: opt.explanation?.trim() || '' }))
        .filter((opt) => opt.is_correct || opt.option_text.length > 0);
      const wrong = sanitized.filter((o) => !o.is_correct);
      const missing = Math.max(0, TARGET_WRONG_OPTIONS - wrong.length);
      if (missing <= 0) {
        toast.info('Você já tem 3 alternativas erradas.');
        return;
      }

      toast.info(`Gerando ${missing} alternativas erradas...`);
      const resp = await apiFetch('/api/ai?handler=generate-wrongs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: current.question_text,
          correct: correct.option_text,
          difficulty: current.difficulty_level,
          language: localeToOpenAiLanguageTag(getActiveLocale()),
          count: missing,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao gerar alternativas erradas');
      const aiCandidates = Array.isArray(json?.wrong) ? json.wrong : [];
      for (const candidate of aiCandidates) {
        if (wrong.length >= TARGET_WRONG_OPTIONS || fields.length >= MAX_OPTIONS) break;
        const txt = String(candidate?.text || '').trim();
        if (!txt) continue;
        if (txt.toLowerCase() === correct.option_text.toLowerCase()) continue;
        if (wrong.some((o) => o.option_text.toLowerCase() === txt.toLowerCase())) continue;
        append({ option_text: txt, is_correct: false, explanation: String(candidate?.explanation || '') });
        wrong.push({ option_text: txt, is_correct: false, explanation: String(candidate?.explanation || '') } as any);
      }
      if (wrong.length < TARGET_WRONG_OPTIONS) {
        toast.warning('Geradas menos alternativas do que o necessário. Complete manualmente.');
      } else {
        toast.success('Alternativas geradas!');
      }
    } catch (e) {
      console.error(e);
      toast.error((e as any)?.message || 'Falha ao gerar alternativas');
    }
  };

  const onSubmit = async (data: QuizQuestionFormData) => {
    setIsSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Não autenticado');

      const normalized = { ...data, difficulty_level: forcedDifficulty };
      const payload = await ensureWrongOptions(normalized, token);
      // Embaralhar ordem das alternativas para evitar padrão fixo de posição da correta
      const shuffledOptions = [...payload.options].sort(() => Math.random() - 0.5);
      const shuffledPayload = { ...payload, options: shuffledOptions };
      await createViaApi(shuffledPayload, token);

      toast.success('Pergunta criada com sucesso!');
      reset({
        question_text: '',
        difficulty_level: forcedDifficulty,
        options: [
          { option_text: '', is_correct: true, explanation: '' },
        ],
      });
      setSelectedDifficulty(forcedDifficulty);
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

  const handleCleanupQuestion = async () => {
    const current = watch("question_text");
    if (!current || current.trim().length < 3) {
      toast.info("Digite a pergunta antes de revisar.");
      return;
    }
    try {
      const resp = await apiFetch("/api/ai?handler=cleanup-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", description: current, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
      });
      const json = await resp.json().catch(() => ({}));
      const usedAI = json?.meta?.usedAI !== false;
      if (!resp.ok || !json?.cleaned?.description) {
        throw new Error(json?.error || "Falha na revisão automática");
      }
      if (!usedAI) {
        toast.error("IA indisponível no momento. Tente novamente.");
        return;
      }
      const cleaned = String(json.cleaned.description || current).trim();
      if (cleaned === current.trim()) {
        toast.success("Nenhuma correção necessária.");
        return;
      }
      reset({ ...watch(), question_text: cleaned });
      toast.success("Pergunta revisada (ortografia e pontuação).");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível revisar a pergunta agora.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova Pergunta</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="rounded-md border p-3 bg-muted/10 text-xs text-muted-foreground">
            XP por pergunta do quiz:{" "}
            <span className="font-medium text-foreground">
              {[5, 10, 20, 50].includes(Number(quizXpReward)) ? `${Number(quizXpReward)} XP` : "não definido"}
            </span>{" "}
            • Dificuldade aplicada: <span className="font-medium text-foreground">{difficultyLevels[forcedDifficulty].label}</span>
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="quick">Rápido (IA)</TabsTrigger>
              <TabsTrigger value="full">Completo</TabsTrigger>
            </TabsList>

            <TabsContent value="quick" className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Pergunta</Label>
                  <div className="flex items-center gap-2">
                    <VoiceRecorderButton
                      size="sm"
                      language={localeToSpeechLanguage(getActiveLocale())}
                      onText={(text) => setQuickQuestionText((p) => [p, text].filter(Boolean).join("\n\n"))}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        const current = String(quickQuestionText || "").trim();
                        if (!current || current.length < 3) {
                          toast.info("Digite a pergunta antes de revisar.");
                          return;
                        }
                        void (async () => {
                          try {
                            const resp = await apiFetch("/api/ai?handler=cleanup-text", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ title: "", description: current, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
                            });
                            const json = await resp.json().catch(() => ({}));
                            const usedAI = json?.meta?.usedAI !== false;
                            if (!resp.ok || !json?.cleaned?.description) throw new Error(json?.error || "Falha na revisão automática");
                            if (!usedAI) {
                              toast.error("IA indisponível no momento. Tente novamente.");
                              return;
                            }
                            const cleaned = String(json.cleaned.description || current).trim();
                            setQuickQuestionText(cleaned);
                            toast.success("Pergunta revisada (ortografia e pontuação).");
                          } catch (e: any) {
                            toast.error(e?.message || "Não foi possível revisar a pergunta agora.");
                          }
                        })();
                      }}
                      title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                    >
                      <Wand2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Textarea value={quickQuestionText} onChange={(e) => setQuickQuestionText(e.target.value)} placeholder="Digite a pergunta..." rows={3} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Resposta correta</Label>
                  <Input value={quickCorrectText} onChange={(e) => setQuickCorrectText(e.target.value)} placeholder="Digite a alternativa correta..." />
                </div>
                <div className="space-y-2">
                  <Label>Explicação (opcional)</Label>
                  <Textarea value={quickExplanation} onChange={(e) => setQuickExplanation(e.target.value)} placeholder="1–3 frases para feedback quando o jogador errar." rows={2} />
                </div>
              </div>

              <Button type="button" disabled={isSubmitting} className="w-full" onClick={() => void submitQuick()}>
                <Save className="h-4 w-4 mr-2" />
                {isSubmitting ? "Gerando e salvando..." : "Gerar erradas e salvar"}
              </Button>
            </TabsContent>

            <TabsContent value="full">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/* Difficulty Level (still available; XP is forced by the quiz setting when possible) */}
                <div className="space-y-2">
                  <Label>Dificuldade</Label>
                  <Select
                    value={selectedDifficulty}
                    onValueChange={(value) => {
                      setSelectedDifficulty(value as DifficultyLevel);
                      reset({ ...watch(), difficulty_level: value as DifficultyLevel });
                    }}
                  >
                    <SelectTrigger disabled={[5, 10, 20, 50].includes(Number(quizXpReward))}>
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
                  {[5, 10, 20, 50].includes(Number(quizXpReward)) ? (
                    <p className="text-xs text-muted-foreground">
                      Observação: este quiz está configurado para {Number(quizXpReward)} XP por pergunta; a dificuldade será ajustada ao salvar.
                    </p>
                  ) : null}
                </div>

                {/* Question Text */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="question_text">Pergunta</Label>
                    <div className="flex items-center gap-2">
                      <VoiceRecorderButton
                        size="sm"
                        language={localeToSpeechLanguage(getActiveLocale())}
                        onText={(text) => {
                          const current = watch();
                          reset({ ...current, question_text: [current.question_text, text].filter(Boolean).join("\n\n") });
                        }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={handleCleanupQuestion}
                        title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                      >
                        <Wand2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
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
                    <div className="text-sm text-muted-foreground">
                      Combo completo: 1 correta com explicação + 3 alternativas incorretas verossímeis para desafiar o jogador.
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={handleGenerateWrongsClick}>
                      Gerar alternativas para revisar
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Alternativas</Label>
                      <p className="text-xs text-muted-foreground">
                        Cadastre a correta com uma explicação clara. Se o jogador errar, mostramos esse texto como feedback imediato.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ option_text: "", is_correct: false, explanation: "" })}
                      disabled={fields.length >= MAX_OPTIONS}
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
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
}
