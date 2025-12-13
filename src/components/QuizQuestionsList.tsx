import { useEffect, useState, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { difficultyLevels, type DifficultyLevel } from "@/lib/validations/quiz";

interface Question {
  id: string;
  question_text: string;
  difficulty_level: DifficultyLevel;
  xp_value: number;
  order_index: number;
}

interface QuizQuestionsListProps {
  challengeId: string;
  onUpdate: () => void;
}

export function QuizQuestionsList({ challengeId, onUpdate }: QuizQuestionsListProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [challengeTitle, setChallengeTitle] = useState<string>("");

  const MILHAO_PRIZE_XP = [100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000] as const;

  const loadQuestions = useCallback(async () => {
    try {
      try {
        const { data: ch } = await supabase.from("challenges").select("title").eq("id", challengeId).maybeSingle();
        if (ch?.title) setChallengeTitle(String(ch.title));
      } catch {
        // ignore
      }
      const { data, error } = await supabase
        .from("quiz_questions")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("order_index");

      if (error) throw error;
      setQuestions((data || []) as Question[]);
    } catch (error) {
      console.error("Error loading questions:", error);
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const handleDelete = useCallback(async (questionId: string) => {
    if (!confirm("Deseja realmente excluir esta pergunta?")) return;

    try {
      const { error } = await supabase.from("quiz_questions").delete().eq("id", questionId);

      if (error) throw error;

      toast.success("Pergunta excluída");
      loadQuestions();
      onUpdate();
    } catch (error) {
      console.error("Error deleting question:", error);
      toast.error("Erro ao excluir pergunta");
    }
  }, [loadQuestions, onUpdate]);

  if (loading) return <div className="text-center text-sm text-muted-foreground">Carregando...</div>;

  if (questions.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground p-4 border-2 border-dashed rounded-lg">
        Nenhuma pergunta adicionada ainda
      </div>
    );
  }

  const isMilhao = /milh(ã|a)o/i.test(challengeTitle || "");
  const totalXP = isMilhao
    ? questions.reduce((sum, _q, idx) => sum + (MILHAO_PRIZE_XP[idx] ?? 0), 0)
    : questions.reduce((sum, q) => sum + q.xp_value, 0);

  const dbToUi: Record<string, DifficultyLevel> = {
    basica: 'basico',
    intermediaria: 'intermediario',
    avancada: 'avancado',
    especialista: 'especialista',
  } as const;

  const milhaoTarget = 10;
  const milhaoProgress = Math.min(100, Math.round((questions.length / milhaoTarget) * 100));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Perguntas ({questions.length})</h3>
        <Badge variant="default" className="text-sm">
          Total: {totalXP} XP
        </Badge>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Progresso para Quiz do Milhão (10 perguntas)</span>
          <span>{milhaoProgress}%</span>
        </div>
        <Progress value={milhaoProgress} className="h-2" />
      </div>
      {questions.map((question, index) => (
        <Card key={question.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">#{index + 1}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {difficultyLevels[dbToUi[question.difficulty_level] || 'basico'].label} -{" "}
                    {isMilhao ? (MILHAO_PRIZE_XP[index] ?? question.xp_value) : question.xp_value} XP
                  </span>
                </div>
                <p className="text-sm">{question.question_text}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(question.id)}
                className="flex-shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
