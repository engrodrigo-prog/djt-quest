import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, ArrowRight, Trophy, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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
  totalXpEarned?: number;
  xpBlockedForLeader?: boolean;
}

export function QuizPlayer({ challengeId }: QuizPlayerProps) {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [options, setOptions] = useState<Option[]>([]);
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadQuestions = useCallback(async () => {
    try {
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
      setOptions(data || []);
      setSelectedOption("");
      setAnswerResult(null);
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
    }
  }, [currentQuestionIndex, loadOptions, questions]);

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
        toast.error("Resposta incorreta");
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
    setAnswerResult(null);
    if (answerResult?.isCompleted) {
      toast.success(`Quiz concluído! Total: ${answerResult.totalXpEarned} XP`);
      navigate("/dashboard");
    } else if (currentQuestionIndex < questions.length - 1) {
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

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>
            Pergunta {currentQuestionIndex + 1} de {questions.length}
          </span>
          <span className="font-medium">{currentQuestion.xp_value} XP</span>
        </div>
        <Progress value={progress} />
      </div>

      {/* Question */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">{currentQuestion.question_text}</CardTitle>
            <span className="text-sm px-3 py-1 rounded-full bg-primary/10 text-primary">
              {currentQuestion.difficulty_level}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Options */}
          <RadioGroup value={selectedOption} onValueChange={setSelectedOption}>
            <div className="space-y-3">
              {options.map((option, index) => {
                const isSelected = selectedOption === option.id;
                const isCorrectOption = answerResult?.correctOptionId === option.id;
                const showCorrect = answerResult && !answerResult.isCorrect && isCorrectOption;
                const showWrong = answerResult && !answerResult.isCorrect && isSelected;

                return (
                  <div
                    key={option.id}
                    className={`flex items-start gap-3 p-4 rounded-lg border-2 transition-colors ${
                      showCorrect
                        ? "border-green-500 bg-green-50 dark:bg-green-950"
                        : showWrong
                        ? "border-red-500 bg-red-50 dark:bg-red-950"
                        : isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <RadioGroupItem value={option.id} id={option.id} disabled={!!answerResult} />
                    <div className="flex-1">
                      <Label htmlFor={option.id} className="cursor-pointer">
                        <span className="font-medium mr-2">{String.fromCharCode(65 + index)}.</span>
                        {option.option_text}
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
                    Ver Resultado Final
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
