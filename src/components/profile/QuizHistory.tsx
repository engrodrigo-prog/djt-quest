import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface QuizHistoryRow {
  id: string;
  answered_at: string;
  is_correct: boolean;
  xp_earned: number;
  question: {
    question_text: string;
    xp_value: number;
    challenge: { title: string } | null;
    options: Array<{ id: string; option_text: string; is_correct: boolean; explanation: string | null }>;
  } | null;
  selected_option: {
    option_text: string;
    explanation: string | null;
  } | null;
}

export function QuizHistory() {
  const { user } = useAuth();
  const [rows, setRows] = useState<QuizHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('user_quiz_answers')
        .select(`
          id,
          answered_at,
          is_correct,
          xp_earned,
          question:quiz_questions(
            question_text,
            xp_value,
            challenge:challenges(title),
            options:quiz_options(id, option_text, is_correct, explanation)
          ),
          selected_option:quiz_options!user_quiz_answers_selected_option_id_fkey(option_text, explanation)
        `)
        .eq('user_id', user.id)
        .order('answered_at', { ascending: false })
        .limit(20);
      if (!error && data) setRows(data as QuizHistoryRow[]);
      setLoading(false);
    };
    load();
  }, [user]);

  const renderCorrectOption = (row: QuizHistoryRow) => {
    const correct = row.question?.options?.find((opt) => opt.is_correct);
    return correct?.option_text || 'N/D';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Quizzes</CardTitle>
        <CardDescription>Questões respondidas recentemente.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p>Carregando...</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Você ainda não respondeu quizzes.</p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{row.question?.challenge?.title || 'Quiz'}</p>
                <p className="text-muted-foreground text-xs">{new Date(row.answered_at).toLocaleString('pt-BR')}</p>
              </div>
              <Badge variant={row.is_correct ? 'default' : 'destructive'}>
                {row.is_correct ? 'Acertou' : 'Errou'}
              </Badge>
            </div>
            <p className="text-sm font-semibold">{row.question?.question_text}</p>
            <div className="text-xs space-y-1">
              <p><span className="font-medium">Sua resposta:</span> {row.selected_option?.option_text || 'N/D'}</p>
              {!row.is_correct && (
                <p><span className="font-medium">Resposta correta:</span> {renderCorrectOption(row)}</p>
              )}
              {row.selected_option?.explanation && (
                <p className="text-muted-foreground">{row.selected_option.explanation}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">XP ganho: {row.xp_earned}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
