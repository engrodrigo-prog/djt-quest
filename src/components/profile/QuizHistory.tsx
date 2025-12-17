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
  challenge_id: string;
  question: {
    question_text: string;
    xp_value: number;
    challenge: { title: string } | null;
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
  const [counts, setCounts] = useState<Record<string, number>>({});

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
          challenge_id,
          question:quiz_questions(
            question_text,
            xp_value,
            challenge:challenges(title)
          ),
          selected_option:quiz_options!user_quiz_answers_selected_option_id_fkey(option_text, explanation)
        `)
        .eq('user_id', user.id)
        .order('answered_at', { ascending: false })
        .limit(20);
      if (!error && data) {
        const casted = data as QuizHistoryRow[];
        setRows(casted);
        // Buscar contagem de perguntas por desafio para estes challenges
        const ids = Array.from(new Set(casted.map((r) => r.challenge_id))).filter(Boolean);
        if (ids.length > 0) {
          const { data: qs } = await supabase
            .from('quiz_questions')
            .select('challenge_id')
            .in('challenge_id', ids);
          const byChallenge: Record<string, number> = {};
          (qs || []).forEach((q: any) => {
            byChallenge[q.challenge_id] = (byChallenge[q.challenge_id] || 0) + 1;
          });
          setCounts(byChallenge);
        }
      }
      setLoading(false);
    };
    load();
  }, [user]);

  return (
    <Card id="quiz-history">
      <CardHeader>
        <CardTitle>Histórico de Quizzes</CardTitle>
        <CardDescription>Resumo por quiz com detalhes das questões.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p>Carregando...</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Você ainda não respondeu quizzes.</p>
        )}

        {/* Agrupar por challenge */}
        {Object.entries(
          rows.reduce((acc, row) => {
            const key = row.challenge_id;
            acc[key] = acc[key] || { title: row.question?.challenge?.title || 'Quiz', items: [] as QuizHistoryRow[] };
            acc[key].items.push(row);
            return acc;
          }, {} as Record<string, { title: string; items: QuizHistoryRow[] }>)
        ).map(([challengeId, group]) => {
          const total = counts[challengeId] || group.items.length;
          const correct = group.items.filter((r) => r.is_correct).length;
          const wrong = group.items.length - correct;
          const xp = group.items.reduce((s, r) => s + (r.xp_earned || 0), 0);
          const lastAt = group.items[0]?.answered_at;
          return (
            <div key={challengeId} className="border rounded-lg">
              <div className="flex items-center justify-between p-3">
                <div>
                  <p className="font-semibold text-sm">{group.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {correct}/{total} corretas • XP {xp} • {new Date(lastAt).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <Badge variant={correct === total ? 'default' : 'secondary'}>
                  {Math.round((correct / Math.max(total, 1)) * 100)}%
                </Badge>
              </div>
              <div className="divide-y">
                {group.items.map((row) => (
                  <div key={row.id} className="p-3 text-sm">
                    <div className="flex items-start justify-between">
                      <p className="font-medium pr-3">{row.question?.question_text}</p>
                      <Badge variant={row.is_correct ? 'default' : 'destructive'}>{row.is_correct ? 'Acertou' : 'Errou'}</Badge>
                    </div>
                    <div className="text-xs mt-1">
                      <p><span className="font-medium">Sua resposta:</span> {row.selected_option?.option_text || 'N/D'}</p>
                      {row.selected_option?.explanation && (
                        <p className="text-muted-foreground">{row.selected_option.explanation}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
