import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, ArrowRight, Trophy, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api";

interface QuizPlayerProps {
  challengeId: string;
}

interface Question {
  id: string;
  question_text: string;
  difficulty_level: string;
  xp_value: number;
  order_index: number;
}

interface Option {
  id: string;
  option_text: string;
  explanation: string | null;
}

interface AnswerResult {
  isCorrect: boolean;
  xpEarned: number;
  explanation: string | null;
  correctOptionId: string | null;
  isCompleted: boolean;
  endedReason?: "completed" | "wrong";
  totalXpEarned?: number;
  xpBlockedForLeader?: boolean;
}

const MILHAO_LEVELS = [
  { level: 1, xp: 100, faixa: "Básico", titulo: "Aquecimento I" },
  { level: 2, xp: 200, faixa: "Básico", titulo: "Aquecimento II" },
  { level: 3, xp: 300, faixa: "Básico", titulo: "Aquecimento III" },
  { level: 4, xp: 400, faixa: "Intermediário", titulo: "Desafio I" },
  { level: 5, xp: 500, faixa: "Intermediário", titulo: "Desafio II" },
  { level: 6, xp: 1000, faixa: "Intermediário", titulo: "Desafio III" },
  { level: 7, xp: 2000, faixa: "Avançado", titulo: "Avanço I" },
  { level: 8, xp: 3000, faixa: "Avançado", titulo: "Avanço II" },
  { level: 9, xp: 5000, faixa: "Avançado", titulo: "Avanço III" },
  { level: 10, xp: 10000, faixa: "Sênior", titulo: "Pergunta Máxima" },
] as const;

type MonitorKey = "subestacoes" | "linhas" | "protecao" | "automacao" | "telecom";
const MONITORS: Record<MonitorKey, { key: MonitorKey; name: string }> = {
  subestacoes: { key: "subestacoes", name: "Monitor Subestações" },
  linhas: { key: "linhas", name: "Monitor Linhas" },
  protecao: { key: "protecao", name: "Monitor Proteção" },
  automacao: { key: "automacao", name: "Monitor Automação" },
  telecom: { key: "telecom", name: "Monitor Telecom" },
};

const inferDomain = (questionText: string, challengeTitle: string, quizSpecialties: string[] | null): MonitorKey => {
  const t = `${challengeTitle || ""} ${questionText || ""}`.toLowerCase();
  const specs = (quizSpecialties || []).map((s) => String(s || "").toLowerCase());

  const has = (needle: string) => t.includes(needle);
  if (specs.some((s) => s.includes("telecom")) || has("telecom") || has("fibra") || has("rádio") || has("radio")) return "telecom";
  if (specs.some((s) => s.includes("autom")) || has("automação") || has("automacao") || has("scada") || has("rtu")) return "automacao";
  if (specs.some((s) => s.includes("prote")) || has("proteção") || has("protecao") || has("relé") || has("rele") || has("ansi")) return "protecao";
  if (has("linha") || has("lt ") || has("torre") || has("isolador") || has("cabos") || has("cabo condutor")) return "linhas";
  return "subestacoes";
};

export function QuizPlayer({ challengeId }: QuizPlayerProps) {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [challengeTitle, setChallengeTitle] = useState<string>('');
  const [challengeSpecialties, setChallengeSpecialties] = useState<string[] | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [options, setOptions] = useState<Option[]>([]);
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [monitorHelp, setMonitorHelp] = useState<{ analysis: string; hint?: string; weak_options?: any[]; monitor?: any; eliminate_option_ids?: string[] } | null>(null);
  const [monitorUsed, setMonitorUsed] = useState(false);
  const [skipUsed, setSkipUsed] = useState(false);
  const [eliminatedOptionIds, setEliminatedOptionIds] = useState<Record<string, true>>({});
  const [helpUsedThisQuestion, setHelpUsedThisQuestion] = useState(false);
  const [monitorDialogOpen, setMonitorDialogOpen] = useState(false);
  const [monitorLoading, setMonitorLoading] = useState(false);

  const loadQuestions = useCallback(async () => {
    try {
      // carregar título do desafio para detectar Quiz do Milhão
      try {
        const { data: challenge } = await supabase
          .from('challenges')
          .select('title, quiz_specialties')
          .eq('id', challengeId)
          .maybeSingle();
        if (challenge?.title) setChallengeTitle(challenge.title);
        if (Array.isArray((challenge as any)?.quiz_specialties)) setChallengeSpecialties((challenge as any).quiz_specialties);
      } catch {/* ignore */}
      // If attempt already submitted, don't show questions (only when attempts table is available)
      const hasAttempts = (import.meta as any).env?.VITE_HAS_QUIZ_ATTEMPTS === '1';
      if (hasAttempts) {
        const { data: session } = await supabase.auth.getSession();
        const uid = session.session?.user?.id;
        if (uid) {
          try {
            const { data: attempt } = await supabase
              .from('quiz_attempts')
              .select('submitted_at')
              .eq('user_id', uid)
              .eq('challenge_id', challengeId)
              .maybeSingle();
            if (attempt?.submitted_at) {
              setQuestions([]);
              setLoading(false);
              toast("Quiz já concluído. Consulte o histórico em Perfil.");
              return;
            }
          } catch {/* ignore if table not present */}
        }
      }
      const { data, error } = await supabase
        .from("quiz_questions")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("order_index");

      if (error) throw error;
      setQuestions(data || []);
    } catch (error) {
      console.error("Error loading questions:", error);
      toast.error("Erro ao carregar perguntas");
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  const loadOptions = useCallback(async (questionId: string) => {
    try {
      const { data, error } = await supabase
        .from("quiz_options")
        .select("id, option_text, explanation")
        .eq("question_id", questionId);

      if (error) throw error;
      const shuffled =
        (data || [])
          .map((opt) => ({ sort: Math.random(), value: opt }))
          .sort((a, b) => a.sort - b.sort)
          .map(({ value }) => value);
      setOptions(shuffled);
      setSelectedOption("");
      setAnswerResult(null);
      setEliminatedOptionIds({});
    } catch (error) {
      console.error("Error loading options:", error);
      toast.error("Erro ao carregar alternativas");
    }
  }, []);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  useEffect(() => {
    if (questions.length > 0) {
      loadOptions(questions[currentQuestionIndex].id);
      setMonitorHelp(null);
      setHelpUsedThisQuestion(false);
    }
  }, [currentQuestionIndex, loadOptions, questions]);

  const isMilhao =
    questions.length === 10 &&
    /milh(ã|a)o/i.test(challengeTitle || '');

  const handleSubmitAnswer = async () => {
    if (!selectedOption) {
      toast.error("Selecione uma alternativa");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");

      const response = await supabase.functions.invoke("submit-quiz-answer", {
        body: {
          question_id: questions[currentQuestionIndex].id,
          option_id: selectedOption,
          used_help: helpUsedThisQuestion,
        },
      });

      if (response.error) throw response.error;

      const result = response.data as AnswerResult;
      setAnswerResult(result);

      if (result.isCorrect) {
        const xpMsg = result.xpBlockedForLeader ? 'Resposta correta registrada' : `Correto! +${result.xpEarned} XP`;
        toast.success(xpMsg);
        if (result.xpBlockedForLeader) {
          toast.info('Líderes não acumulam XP nos quizzes.');
        }
      } else {
        if (isMilhao && result.isCompleted && result.endedReason === "wrong") {
          toast.error(`Resposta incorreta. Fim de jogo! Total: ${result.totalXpEarned ?? 0} XP`);
        } else {
          toast.error("Resposta incorreta");
        }
      }
    } catch (error) {
      console.error("Error submitting answer:", error);
      const msg = (error as any)?.message || '';
      if (typeof msg === 'string' && msg.toLowerCase().includes('tentativa já finalizada')) {
        toast("Quiz já concluído. Consulte o histórico em Perfil.");
        setAnswerResult({ isCorrect: true, xpEarned: 0, explanation: null as any, correctOptionId: null, isCompleted: true });
      } else {
        toast.error("Erro ao enviar resposta");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    // Clear UI state early for smoother transitions
    setSelectedOption("");
    if (answerResult?.isCompleted) {
      const total = answerResult?.totalXpEarned ?? 0;
      if (isMilhao && answerResult.endedReason === "wrong") {
        toast.error(`Fim de jogo! Total acumulado: ${total} XP`);
      } else {
        toast.success(`Quiz concluído! Total: ${total} XP`);
      }
      navigate("/dashboard");
      return;
    }
    setAnswerResult(null);
    if (isMilhao && answerResult && !answerResult.isCorrect) {
      // Regra do Quiz do Milhão: errou, encerra (fallback UI)
      navigate("/dashboard");
      return;
    }
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="text-center">Carregando quiz...</div>
        </CardContent>
      </Card>
    );
  }

  if (questions.length === 0) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="text-center">Nenhuma pergunta disponível neste quiz.</div>
        </CardContent>
      </Card>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

  const canUseMonitor = isMilhao && !monitorUsed && !answerResult;
  const canSkip = isMilhao && !skipUsed && !answerResult && currentQuestionIndex < questions.length - 1;
  const currentMilhaoMeta = isMilhao ? MILHAO_LEVELS[currentQuestionIndex] : null;
  const domain = inferDomain(currentQuestion.question_text, challengeTitle, challengeSpecialties);
  const monitor = MONITORS[domain];

  const difficultyLabelMap: Record<string, string> = {
    basico: "Básico",
    basica: "Básico",
    intermediario: "Intermediário",
    intermediaria: "Intermediário",
    avancado: "Avançado",
    avancada: "Avançado",
    especialista: "Especialista",
  };
  const difficultyLabel =
    difficultyLabelMap[currentQuestion.difficulty_level] || currentQuestion.difficulty_level;

  return (
    <div className="space-y-6">
      {/* Progress / Milhão HUD */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          {isMilhao && currentMilhaoMeta ? (
            <span className="font-medium">
              Nível {currentMilhaoMeta.level} de 10 • {currentMilhaoMeta.titulo}
            </span>
          ) : (
            <span>
              Pergunta {currentQuestionIndex + 1} de {questions.length}
            </span>
          )}
          <span className="font-medium">
            {isMilhao && currentMilhaoMeta ? currentMilhaoMeta.xp : currentQuestion.xp_value} XP
          </span>
        </div>
        <Progress value={progress} />
        {isMilhao && currentMilhaoMeta && (
          <>
            <p className="text-[11px] text-muted-foreground">
              {currentMilhaoMeta.faixa} — a cada pergunta o desafio aumenta (10 níveis progressivos).
            </p>
            <div className="flex flex-wrap gap-1 text-[10px]">
              {MILHAO_LEVELS.map((lvl, idx) => {
                const isCurrent = idx === currentQuestionIndex;
                return (
                  <span
                    key={lvl.level}
                    className={`px-2 py-0.5 rounded-full border ${
                      isCurrent
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background/40 text-muted-foreground border-border"
                    }`}
                  >
                    {lvl.level}
                  </span>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Question */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold leading-tight text-foreground">
              {currentQuestion.question_text}
            </CardTitle>
            <span className="text-sm px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {isMilhao && currentMilhaoMeta
                ? `${currentMilhaoMeta.faixa} • Nível ${currentMilhaoMeta.level}`
                : difficultyLabel}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {(canSkip || canUseMonitor) && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 rounded-md border border-primary/25 bg-primary/5">
              <div className="text-sm text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Ajudas do Quiz</span>
                <span className="block">
                  Pular (1x) ou consultar o especialista do tema (1x) para eliminar 2 alternativas.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {canSkip && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSkipUsed(true);
                      setHelpUsedThisQuestion(true);
                      toast.message("Pergunta pulada", { description: "Você pode pular apenas uma vez." });
                      setCurrentQuestionIndex((prev) => Math.min(prev + 1, questions.length - 1));
                    }}
                  >
                    Pular
                  </Button>
                )}
                {canUseMonitor && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        setMonitorDialogOpen(true);
                        setMonitorLoading(true);
                        const payload = {
                          question_id: currentQuestion.id,
                          question: currentQuestion.question_text,
                          options: options,
                          nivel: currentQuestionIndex + 1,
                          domain,
                        };
                        const resp = await apiFetch("/api/ai?handler=quiz-burini", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(payload),
                        });
                        const json = await resp.json().catch(() => ({}));
                        if (!resp.ok) throw new Error(json?.error || "Falha ao consultar especialista");
                        const help = json?.help || json;
                        if (help?.analysis) {
                          setMonitorHelp(help);
                          setMonitorUsed(true);
                          setHelpUsedThisQuestion(true);
                          setMonitorLoading(false);
                          const ids = Array.isArray(help?.eliminate_option_ids) ? help.eliminate_option_ids : [];
                          if (ids.length) {
                            const map: Record<string, true> = {};
                            ids.slice(0, 2).forEach((id: string) => {
                              if (id) map[id] = true;
                            });
                            setEliminatedOptionIds(map);
                            if (map[selectedOption]) setSelectedOption("");
                          }
                          toast.success(`${(help?.monitor?.name || monitor.name)} eliminou 2 alternativas.`);
                        } else {
                          setMonitorLoading(false);
                          toast.error("Não foi possível obter ajuda agora.");
                        }
                      } catch (e: any) {
                        console.error("Erro ao acionar especialista:", e);
                        setMonitorLoading(false);
                        setMonitorDialogOpen(false);
                        toast.error("Erro ao acionar o especialista.");
                      }
                    }}
                  >
                    Consultar {monitor.name}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Options */}
          <RadioGroup value={selectedOption} onValueChange={setSelectedOption}>
            <div className="space-y-3">
              {options.map((option, index) => {
                const isSelected = selectedOption === option.id;
                const isCorrectOption = answerResult?.correctOptionId === option.id;
                const showCorrect = answerResult && !answerResult.isCorrect && isCorrectOption;
                const showWrong = answerResult && !answerResult.isCorrect && isSelected;
                const isEliminated = !answerResult && Boolean(eliminatedOptionIds[option.id]);

                return (
                  <div
                    key={option.id}
                    className={`flex items-start gap-3 p-4 rounded-lg border-2 transition-colors ${
                      showCorrect
                        ? "border-green-500 bg-green-50 dark:bg-green-950"
                        : showWrong
                        ? "border-red-500 bg-red-50 dark:bg-red-950"
                        : isEliminated
                        ? "border-border bg-muted/40 opacity-60"
                        : isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <RadioGroupItem value={option.id} id={option.id} disabled={!!answerResult || isEliminated} />
                    <div className="flex-1">
                      <Label
                        htmlFor={option.id}
                        className={`cursor-pointer ${isEliminated ? "line-through text-muted-foreground" : ""}`}
                      >
                        <span className="font-semibold mr-2 text-foreground">{String.fromCharCode(65 + index)}.</span>
                        {isEliminated ? "Alternativa eliminada" : option.option_text}
                      </Label>
                      {answerResult && (isSelected || showCorrect) && option.explanation && (
                        <p className="mt-2 text-sm text-muted-foreground">{option.explanation}</p>
                      )}
                    </div>
                    {showCorrect && <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />}
                    {showWrong && <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />}
                  </div>
                );
              })}
            </div>
          </RadioGroup>

          {/* Feedback */}
          {answerResult && (
            <div
              className={`p-4 rounded-lg ${
                answerResult.isCorrect ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {answerResult.isCorrect ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="font-semibold text-green-700 dark:text-green-300">
                      Correto! +{answerResult.xpEarned} XP
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-red-600" />
                    <span className="font-semibold text-red-700 dark:text-red-300">Incorreto</span>
                  </>
                )}
              </div>
              {answerResult.xpBlockedForLeader && (
                <p className="text-xs text-muted-foreground">
                  Líderes não acumulam XP nos quizzes, mas o acerto foi registrado no histórico.
                </p>
              )}
            </div>
          )}

          <Dialog open={monitorDialogOpen} onOpenChange={setMonitorDialogOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {monitorLoading ? "Chamando especialista..." : `Consulta • ${monitorHelp?.monitor?.name || monitor.name}`}
                </DialogTitle>
                <DialogDescription>
                  {monitorLoading
                    ? "O Monitor está analisando a pergunta e vai eliminar 2 alternativas."
                    : "Ajuda usada: 1 vez. As alternativas eliminadas ficam riscadas."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-start gap-4">
                <div
                  aria-hidden
                  className={`h-14 w-14 rounded-full border flex items-center justify-center ${
                    monitorLoading
                      ? "bg-primary/15 border-primary/30 animate-pulse"
                      : "bg-primary/10 border-border"
                  }`}
                >
                  <AlertCircle className={`h-6 w-6 ${monitorLoading ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 space-y-3">
                  {monitorLoading ? (
                    <div className="space-y-2">
                      <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
                      <div className="h-3 w-full rounded bg-muted animate-pulse" />
                      <div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
                    </div>
                  ) : monitorHelp ? (
                    <>
                      <p className="whitespace-pre-line text-sm text-foreground">{monitorHelp.analysis}</p>
                      {Array.isArray(monitorHelp.weak_options) && monitorHelp.weak_options.length > 0 && (
                        <p className="text-sm">
                          <span className="font-semibold">Alternativas menos prováveis:</span>{" "}
                          {monitorHelp.weak_options.map((w: any) => w?.label).filter(Boolean).join(", ")}
                        </p>
                      )}
                      {monitorHelp.hint && <p className="text-sm italic text-muted-foreground">{monitorHelp.hint}</p>}
                      <Button type="button" variant="secondary" onClick={() => setMonitorDialogOpen(false)}>
                        Entendi
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma resposta disponível.</p>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Actions */}
          <div className="flex gap-3">
            {!answerResult ? (
              <Button onClick={handleSubmitAnswer} disabled={!selectedOption || isSubmitting} className="w-full">
                {isSubmitting ? "Enviando..." : "Confirmar Resposta"}
              </Button>
            ) : (
              <Button onClick={handleNextQuestion} className="w-full">
                {answerResult.isCompleted ? (
                  <>
                    <Trophy className="h-4 w-4 mr-2" />
                    {isMilhao && answerResult.endedReason === "wrong" ? "Finalizar partida" : "Ver Resultado Final"}
                  </>
                ) : (
                  <>
                    Próxima Pergunta
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
