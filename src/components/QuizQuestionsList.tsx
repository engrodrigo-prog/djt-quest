import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

  useEffect(() => {
    loadQuestions();
  }, [challengeId]);

  const loadQuestions = async () => {
    try {
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
  };

  const handleDelete = async (questionId: string) => {
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
  };

  if (loading) return <div className="text-center text-sm text-muted-foreground">Carregando...</div>;

  if (questions.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground p-4 border-2 border-dashed rounded-lg">
        Nenhuma pergunta adicionada ainda
      </div>
    );
  }

  const totalXP = questions.reduce((sum, q) => sum + q.xp_value, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Perguntas ({questions.length})</h3>
        <Badge variant="default" className="text-sm">
          Total: {totalXP} XP
        </Badge>
      </div>
      {questions.map((question, index) => (
        <Card key={question.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">#{index + 1}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {difficultyLevels[question.difficulty_level].label} - {question.xp_value} XP
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
