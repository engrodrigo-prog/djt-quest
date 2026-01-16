import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, ArrowRight, Trophy, Volume2 } from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";
import buriniImg from "@/assets/backgrounds/burini.webp";
import oliveiraImg from "@/assets/backgrounds/Oliveira.png";
import { useSfx } from "@/lib/sfx";
import { useTts } from "@/lib/tts";

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
  bestScoreBefore?: number;
  bestScoreAfter?: number;
  xpBlockedForLeader?: boolean;
  xpApplied?: boolean;
  profileXpAfter?: number | null;
  answerKeyRestricted?: boolean;
}

interface PostWrongHelpState {
  loading: boolean;
  text: string;
  source: "ai" | "fallback";
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

type MonitorKey = "subestacoes" | "linhas" | "protecao" | "automacao" | "telecom" | "seguranca";
const MONITORS: Record<MonitorKey, { key: MonitorKey; name: string }> = {
  subestacoes: { key: "subestacoes", name: "Monitor Subestações" },
  linhas: { key: "linhas", name: "Monitor Linhas" },
  protecao: { key: "protecao", name: "Monitor Proteção" },
  automacao: { key: "automacao", name: "Monitor Automação" },
  telecom: { key: "telecom", name: "Monitor Telecom" },
  seguranca: { key: "seguranca", name: "Monitor Segurança (Oliveira)" },
};

const inferDomain = (questionText: string, challengeTitle: string, quizSpecialties: string[] | null): MonitorKey => {
  const t = `${challengeTitle || ""} ${questionText || ""}`.toLowerCase();
  const specs = (quizSpecialties || []).map((s) => String(s || "").toLowerCase());

  const has = (needle: string) => t.includes(needle);
  if (
    specs.some((s) => s.includes("seguran")) ||
    has("segurança") ||
    has("seguranca") ||
    has("epi") ||
    has("cipa") ||
    has("acidente") ||
    has("quase acidente") ||
    /\bnr\s*\d+\b/i.test(t)
  ) {
    return "seguranca";
  }
  if (specs.some((s) => s.includes("telecom")) || has("telecom") || has("fibra") || has("rádio") || has("radio")) return "telecom";
  if (specs.some((s) => s.includes("autom")) || has("automação") || has("automacao") || has("scada") || has("rtu")) return "automacao";
  if (specs.some((s) => s.includes("prote")) || has("proteção") || has("protecao") || has("relé") || has("rele") || has("ansi")) return "protecao";
  if (has("linha") || has("lt ") || has("torre") || has("isolador") || has("cabos") || has("cabo condutor")) return "linhas";
  return "subestacoes";
};

export function QuizPlayer({ challengeId }: QuizPlayerProps) {
  const navigate = useNavigate();
  const { refreshUserSession } = useAuth();
  const { play: playSfx } = useSfx();
  const { ttsEnabled, isSpeaking, speak, stop: stopTts } = useTts();
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
  const [postWrongHelp, setPostWrongHelp] = useState<PostWrongHelpState | null>(null);
  const postWrongHelpKeyRef = useRef<string | null>(null);
  const progressSyncForChallengeRef = useRef<string | null>(null);

  const syncProgressFromDb = useCallback(async (opts?: { silent?: boolean }) => {
    if (!challengeId) return;
    if (!questions.length) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;

      // Se a tentativa já foi finalizada (ex.: errou no Milhão), não deve permitir responder.
      try {
        const { data: attempt } = await supabase
          .from('quiz_attempts')
          .select('submitted_at, score')
          .eq('user_id', uid)
          .eq('challenge_id', challengeId)
          .maybeSingle();
        if (attempt?.submitted_at) {
          if (!opts?.silent) toast("Sua tentativa já foi finalizada. Consulte o histórico em Perfil.");
          setQuestions([]);
          setLoading(false);
          return;
        }
      } catch {
        // ignore if table not present
      }

      const { data: answers } = await supabase
        .from('user_quiz_answers')
        .select('question_id, xp_earned')
        .eq('user_id', uid)
        .eq('challenge_id', challengeId);

      const answeredIds = new Set((answers || []).map((a: any) => String(a.question_id)));
      const nextIndex = questions.findIndex((q) => !answeredIds.has(String(q.id)));
      if (nextIndex === -1) {
        if (!opts?.silent) toast("Quiz já concluído. Consulte o histórico em Perfil.");
        setQuestions([]);
        setLoading(false);
        return;
      }

      if (nextIndex !== currentQuestionIndex) {
        setCurrentQuestionIndex(nextIndex);
        if (!opts?.silent && nextIndex > 0) {
          toast.message("Retomando sua tentativa", { description: `Voltando na pergunta ${nextIndex + 1}.` });
        }
      }
    } catch {
      // silencioso
    }
  }, [challengeId, currentQuestionIndex, questions]);

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
      // If attempt already submitted, don't show questions
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

  // Retomar progresso automaticamente (evita erro 400 em caso de recarregar a página no meio do quiz)
  useEffect(() => {
    if (questions.length === 0) return;
    if (progressSyncForChallengeRef.current === challengeId) return;
    progressSyncForChallengeRef.current = challengeId;
    syncProgressFromDb({ silent: true });
  }, [challengeId, questions.length, syncProgressFromDb]);

  useEffect(() => {
    if (questions.length > 0) {
      loadOptions(questions[currentQuestionIndex].id);
      setMonitorHelp(null);
      setHelpUsedThisQuestion(false);
      setPostWrongHelp(null);
      postWrongHelpKeyRef.current = null;
      stopTts();
    }
  }, [currentQuestionIndex, loadOptions, questions, stopTts]);

  const isMilhao =
    questions.length === 10 &&
    /milh(ã|a)o/i.test(challengeTitle || '');

  useEffect(() => {
    if (!answerResult || answerResult.isCorrect) return;
    if (!isMilhao) return;
    const q = questions[currentQuestionIndex];
    if (!q) return;
    if (!options.length) return;
    if (!answerResult.correctOptionId) return;

    const correctIdx = options.findIndex((o) => o.id === answerResult.correctOptionId);
    const selectedIdx = options.findIndex((o) => o.id === selectedOption);
    const correctLabel = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : null;
    const selectedLabel = selectedIdx >= 0 ? String.fromCharCode(65 + selectedIdx) : null;
    const correctOpt = correctIdx >= 0 ? options[correctIdx] : null;
    const selectedOpt = selectedIdx >= 0 ? options[selectedIdx] : null;

    const key = `${q.id}:${answerResult.correctOptionId}:${selectedOption || "none"}`;
    if (postWrongHelpKeyRef.current === key) return;
    postWrongHelpKeyRef.current = key;

    const fallbackParts: string[] = ["Vamos revisar rapidinho:"];
    if (correctLabel && correctOpt) {
      fallbackParts.push(`A correta era ${correctLabel}. ${correctOpt.option_text}`);
      if (correctOpt.explanation) fallbackParts.push(correctOpt.explanation);
    }
    if (selectedLabel && selectedOpt) {
      fallbackParts.push(`Você marcou ${selectedLabel}. ${selectedOpt.option_text}`);
    }
    fallbackParts.push("Dica: procure a palavra‑chave e o critério (ANSI, seletividade, tempo/corrente) antes de escolher.");

    setPostWrongHelp({ loading: true, text: fallbackParts.filter(Boolean).join("\n\n"), source: "fallback" });

    (async () => {
      try {
        const domain = inferDomain(q.question_text, challengeTitle, challengeSpecialties);
        const payload = {
          mode: "post_wrong",
          question_id: q.id,
          question: q.question_text,
          options,
          nivel: currentQuestionIndex + 1,
          domain,
          selected_label: selectedLabel,
          correct_label: correctLabel,
        };
        const resp = await apiFetch("/api/ai?handler=quiz-burini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao consultar o monitor");
        const help = json?.help || json;
        const text = String(help?.analysis || "").trim();
        if (!text) throw new Error("Resposta vazia do monitor");
        setPostWrongHelp({ loading: false, text, source: "ai" });
      } catch (e) {
        console.error("Monitor pós-erro:", e);
        setPostWrongHelp((prev) => (prev ? { ...prev, loading: false } : prev));
      }
    })();
  }, [answerResult, challengeSpecialties, challengeTitle, currentQuestionIndex, isMilhao, options, questions, selectedOption]);

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

      if (response.error) {
        let serverMsg = '';
        try {
          const resp = (response as any)?.response as Response | undefined;
          if (resp) {
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const j = await resp.json().catch(() => ({}));
              serverMsg = String((j as any)?.error || '');
            } else {
              serverMsg = String(await resp.text()).trim();
            }
          }
        } catch {
          // ignore
        }
        const msg = (serverMsg || (response.error as any)?.message || '').trim();
        const e: any = new Error(msg || 'Erro ao enviar resposta');
        e._raw = response.error;
        throw e;
      }

      const result = response.data as AnswerResult;
      setAnswerResult(result);

      if (result.isCorrect) {
        playSfx("correct");
        const bestBefore = typeof result.bestScoreBefore === "number" ? result.bestScoreBefore : null;
        const bestAfter = typeof result.bestScoreAfter === "number" ? result.bestScoreAfter : null;

        if (result.xpBlockedForLeader) {
          toast.success("Resposta correta registrada");
        } else if (isMilhao) {
          if (result.xpEarned > 0) {
            toast.success(`Correto! +${result.xpEarned} XP`);
            if (bestBefore != null && bestAfter != null && bestAfter > bestBefore) {
              toast.message("Novo recorde no Milhão!", { description: `${bestAfter} XP acumulado.` });
            }
          } else {
            toast.success("Correto!");
            if (bestAfter != null) {
              toast.message("Sem XP extra (recorde já maior)", { description: `Seu recorde atual é ${bestAfter} XP.` });
            }
          }
        } else {
          toast.success(`Correto! +${result.xpEarned} XP`);
        }
        if (result.xpBlockedForLeader) {
          toast.info('Líderes não acumulam XP nos quizzes.');
        }
        if (!result.xpBlockedForLeader && result.xpEarned > 0) {
          if (result.xpApplied === false) {
            toast.error("Resposta correta, mas houve falha ao aplicar o XP. Atualize a página e tente novamente.");
          }
          refreshUserSession().catch((e) => console.warn("QuizPlayer: refreshUserSession failed", e));
        }
      } else {
        playSfx("wrong");
        if (isMilhao && result.isCompleted && result.endedReason === "wrong") {
          const total = Number(result.totalXpEarned ?? 0) || 0;
          const bestAfter = typeof result.bestScoreAfter === "number" ? result.bestScoreAfter : null;
          if (bestAfter != null && bestAfter > total) {
            toast.error(`Resposta incorreta. Fim de jogo! Total: ${total} XP (recorde: ${bestAfter} XP)`);
          } else {
            toast.error(`Resposta incorreta. Fim de jogo! Total: ${total} XP`);
          }
        } else {
          toast.error("Resposta incorreta");
        }
      }
    } catch (error) {
      console.error("Error submitting answer:", error);
      const msg = String((error as any)?.message || '').trim();
      if (msg.toLowerCase().includes('tentativa já finalizada')) {
        toast("Sua tentativa já foi finalizada. Consulte o histórico em Perfil.");
        setAnswerResult({ isCorrect: true, xpEarned: 0, explanation: null as any, correctOptionId: null, isCompleted: true });
      } else if (msg.toLowerCase().includes('já respondeu')) {
        toast.message("Esta pergunta já foi respondida. Retomando…");
        await syncProgressFromDb({ silent: true });
      } else {
        toast.error(msg || "Erro ao enviar resposta");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    // Clear UI state early for smoother transitions
    setSelectedOption("");
    if (answerResult?.isCompleted) {
      refreshUserSession().catch((e) => console.warn("QuizPlayer: refreshUserSession failed", e));
      const total = answerResult?.totalXpEarned ?? 0;
      if (isMilhao && answerResult.endedReason === "wrong") {
        toast.error(`Fim de jogo! Total acumulado: ${total} XP`);
      } else {
        playSfx("complete");
        toast.success(`Quiz concluído! Total: ${total} XP`);
      }
      navigate("/dashboard");
      return;
    }
    setAnswerResult(null);
    if (isMilhao && answerResult && !answerResult.isCorrect) {
      // Regra do Quiz do Milhão: errou, encerra (fallback UI)
      refreshUserSession().catch((e) => console.warn("QuizPlayer: refreshUserSession failed", e));
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
  const monitorAvatar = domain === "seguranca" ? oliveiraImg : buriniImg;
  const selectedOptionObj = options.find((o) => o.id === selectedOption) || null;
  const selectedOptionIndex = selectedOptionObj ? options.findIndex((o) => o.id === selectedOptionObj.id) : -1;
  const selectedOptionLabel = selectedOptionIndex >= 0 ? String.fromCharCode(65 + selectedOptionIndex) : null;
  const correctOptionObj =
    answerResult?.correctOptionId ? options.find((o) => o.id === answerResult.correctOptionId) || null : null;
  const correctOptionIndex = correctOptionObj ? options.findIndex((o) => o.id === correctOptionObj.id) : -1;
  const correctOptionLabel = correctOptionIndex >= 0 ? String.fromCharCode(65 + correctOptionIndex) : null;
  const questionTtsText = (() => {
    const q = String(currentQuestion.question_text || "").trim();
    const opts = (options || [])
      .map((o, idx) => {
        const label = String.fromCharCode(65 + idx);
        const text = String(o?.option_text || "").trim();
        return text ? `${label}. ${text}` : null;
      })
      .filter(Boolean)
      .join("\n");
    const header = isMilhao && currentMilhaoMeta ? `Pergunta nível ${currentMilhaoMeta.level}.` : `Pergunta ${currentQuestionIndex + 1}.`;
    return [header, q, opts ? `Alternativas:\n${opts}` : ""].filter(Boolean).join("\n\n");
  })();

  const monitorReviewFallbackText = (() => {
    if (!answerResult || answerResult.isCorrect) return "";
    const parts: string[] = ["Vamos revisar rapidinho:"];
    if (correctOptionLabel && correctOptionObj) {
      parts.push(`A correta era ${correctOptionLabel}. ${correctOptionObj.option_text}`);
      if (correctOptionObj.explanation) parts.push(correctOptionObj.explanation);
    }
    if (selectedOptionLabel && selectedOptionObj) {
      parts.push(`Você marcou ${selectedOptionLabel}. ${selectedOptionObj.option_text}`);
    }
    parts.push("Dica: procure a palavra‑chave e o critério (ANSI, seletividade, tempo/corrente) antes de escolher.");
    return parts.filter(Boolean).join("\n\n");
  })();
  const monitorReviewText = String(postWrongHelp?.text || monitorReviewFallbackText || "").trim();

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
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-lg font-semibold leading-tight text-foreground">
              {currentQuestion.question_text}
            </CardTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={isSpeaking}
                onClick={async () => {
                  try {
                    if (!ttsEnabled) {
                      toast.info("Ative a leitura em voz no menu do perfil.");
                      return;
                    }
                    await speak(questionTtsText);
                  } catch (e: any) {
                    toast.error(e?.message || "Falha ao gerar áudio");
                  }
                }}
                title="Ouvir pergunta e alternativas"
                aria-label="Ouvir pergunta e alternativas"
              >
                <Volume2 className="h-4 w-4" />
              </Button>
              <span className="text-sm px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                {isMilhao && currentMilhaoMeta
                  ? `${currentMilhaoMeta.faixa} • Nível ${currentMilhaoMeta.level}`
                  : difficultyLabel}
              </span>
            </div>
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
              {!answerResult.isCorrect && (
                <div className="space-y-2 text-sm">
                  <p className="text-foreground">
                    <span className="font-semibold">Resposta correta:</span>{" "}
                    {correctOptionObj ? (
                      <>
                        {correctOptionLabel ? `${correctOptionLabel}. ` : ""}
                        {correctOptionObj.option_text}
                      </>
                    ) : (
                      <span>
                        {answerResult.answerKeyRestricted ? "Indisponível (gabarito restrito)." : "Indisponível."}
                      </span>
                    )}
                  </p>
                  {correctOptionObj?.explanation && (
                    <p className="text-muted-foreground">
                      <span className="font-semibold text-foreground">Por quê:</span> {correctOptionObj.explanation}
                    </p>
                  )}
                  {selectedOptionObj && (
                    <p className="text-muted-foreground">
                      <span className="font-semibold text-foreground">Sua resposta:</span>{" "}
                      {selectedOptionLabel ? `${selectedOptionLabel}. ` : ""}
                      {selectedOptionObj.option_text}
                      {selectedOptionObj.explanation ? ` — ${selectedOptionObj.explanation}` : ""}
                    </p>
                  )}
                </div>
              )}
              {answerResult.xpBlockedForLeader && (
                <p className="text-xs text-muted-foreground">
                  Líderes não acumulam XP nos quizzes, mas o acerto foi registrado no histórico.
                </p>
              )}
            </div>
          )}

          {answerResult && !answerResult.isCorrect && isMilhao && monitorReviewText && (
            <div className="rounded-lg border bg-background/40 p-4">
              <div className="flex items-start gap-3">
                <img
                  src={monitorAvatar}
                  alt={monitor.name}
                  className="h-24 w-24 rounded-2xl object-cover border border-border shadow-sm"
                />
                <div className="relative flex-1 rounded-xl border bg-background p-4 shadow-sm">
                  <div
                    aria-hidden
                    className="absolute -left-[12px] top-10 h-0 w-0 border-y-[12px] border-y-transparent border-r-[12px] border-r-border"
                  />
                  <div
                    aria-hidden
                    className="absolute -left-[11px] top-10 h-0 w-0 border-y-[11px] border-y-transparent border-r-[11px] border-r-background"
                  />
                  <p className="text-xs text-muted-foreground mb-1">{monitor.name} • Revisão</p>
                  <p className="whitespace-pre-line text-sm text-foreground">{monitorReviewText}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          if (!ttsEnabled) {
                            toast.info("Ative a leitura em voz no menu do perfil.");
                            return;
                          }
                          await speak(monitorReviewText);
                        } catch (e: any) {
                          toast.error(e?.message || "Falha ao gerar áudio");
                        }
                      }}
                      disabled={isSpeaking}
                    >
                      Ouvir
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={stopTts} disabled={!isSpeaking}>
                      Parar
                    </Button>
                    {postWrongHelp?.loading && (
                      <span className="text-xs text-muted-foreground">Analisando com o monitor…</span>
                    )}
                  </div>
                </div>
              </div>
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
                  className={`h-24 w-24 rounded-2xl border overflow-hidden flex items-center justify-center ${
                    monitorLoading ? "border-primary/30 animate-pulse" : "border-border"
                  }`}
                >
                  <img
                    src={monitorAvatar}
                    alt={monitorHelp?.monitor?.name || monitor.name}
                    className="h-full w-full object-cover"
                  />
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
