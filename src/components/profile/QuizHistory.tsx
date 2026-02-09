import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiFetch } from '@/lib/api';
import { getActiveLocale } from '@/lib/i18n/activeLocale';
import { useSearchParams } from 'react-router-dom';

interface QuizHistoryRow {
  id: string;
  answered_at: string | null;
  is_correct: boolean;
  xp_earned: number;
  challenge_id: string;
  question_id: string;
  selected_option_id: string;
}

type QuizListItem = {
  challengeId: string;
  title: string;
  lastAnsweredAt: string | null;
  answeredCount: number;
  correctCount: number;
  xp: number;
  totalQuestions: number;
};

type QuizDetailOption = {
  id: string;
  option_text: string;
  explanation: string | null;
  // Available only when fetched via curator endpoint
  is_correct?: boolean;
};

type QuizDetailQuestion = {
  id: string;
  question_text: string;
  order_index?: number | null;
  options: QuizDetailOption[];
};

type QuizDetail = {
  challengeId: string;
  title: string;
  questions: QuizDetailQuestion[];
};

export function QuizHistory() {
  const { user, userRole, isContentCurator } = useAuth();
  const canSeeAnswerKey = Boolean(userRole === 'admin' || isContentCurator);
  const [searchParams, setSearchParams] = useSearchParams();
  const didAutoOpenRef = useRef<string | null>(null);

  const [rows, setRows] = useState<QuizHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<QuizDetail | null>(null);

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
          question_id,
          selected_option_id
        `)
        .eq('user_id', user.id)
        .order('answered_at', { ascending: false })
        .limit(500);
      if (!error && data) {
        const casted = data as QuizHistoryRow[];
        setRows(casted);
        const ids = Array.from(new Set(casted.map((r) => r.challenge_id))).filter(Boolean).slice(0, 30);
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

          // Titles (best-effort)
          const { data: chs } = await supabase.from('challenges').select('id, title').in('id', ids);
          const byId: Record<string, string> = {};
          (chs || []).forEach((c: any) => {
            if (c?.id) byId[String(c.id)] = String(c.title || 'Quiz');
          });
          setTitles(byId);
        }
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const quizList: QuizListItem[] = useMemo(() => {
    const grouped = new Map<string, QuizHistoryRow[]>();
    for (const r of rows) {
      const cid = String(r.challenge_id || '');
      if (!cid) continue;
      if (!grouped.has(cid)) grouped.set(cid, []);
      grouped.get(cid)!.push(r);
    }

    return Array.from(grouped.entries()).map(([challengeId, items]) => {
      const totalQuestions = counts[challengeId] || items.length;
      const correctCount = items.filter((r) => r.is_correct).length;
      const answeredCount = items.length;
      const xp = items.reduce((s, r) => s + (Number(r.xp_earned || 0) || 0), 0);
      const lastAnsweredAt = items[0]?.answered_at ?? null;
      const title = titles[challengeId] || 'Quiz';
      return { challengeId, title, lastAnsweredAt, answeredCount, correctCount, xp, totalQuestions };
    });
  }, [counts, rows, titles]);

  const answersByQuestionId = useMemo(() => {
    const map = new Map<string, QuizHistoryRow>();
    for (const r of rows) {
      const qid = String(r.question_id || '');
      if (!qid) continue;
      // Keep the most recent answer per question
      if (!map.has(qid)) map.set(qid, r);
    }
    return map;
  }, [rows]);

  const openQuizDetail = useCallback(
    async (challengeId: string) => {
      if (!user) return;
      setDetailOpen(true);
      setDetailLoading(true);
      setDetail(null);
      try {
        const title = titles[challengeId] || 'Quiz';

        // If curator/admin, fetch via Studio endpoint to include answer key (is_correct).
        if (canSeeAnswerKey) {
          const { data: session } = await supabase.auth.getSession();
          const token = session.session?.access_token;
          if (!token) throw new Error('Não autenticado');
          const resp = await apiFetch(`/api/admin?handler=curation-get-quiz&id=${encodeURIComponent(challengeId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar quiz');
          const qs = Array.isArray(json?.questions) ? json.questions : [];
          const questions: QuizDetailQuestion[] = qs.map((q: any) => ({
            id: String(q?.id || ''),
            question_text: String(q?.question_text || ''),
            order_index: q?.order_index ?? null,
            options: Array.isArray(q?.options)
              ? q.options.map((o: any) => ({
                  id: String(o?.id || ''),
                  option_text: String(o?.option_text || ''),
                  explanation: o?.explanation != null ? String(o.explanation) : null,
                  is_correct: Boolean(o?.is_correct),
                }))
              : [],
          }));
          setDetail({ challengeId, title: String(json?.quiz?.title || title), questions });
          return;
        }

        // Otherwise, fetch the full quiz without answer key (RLS blocks is_correct).
        const { data: qRows, error: qErr } = await supabase
          .from('quiz_questions')
          .select('id, question_text, order_index')
          .eq('challenge_id', challengeId)
          .order('order_index', { ascending: true });
        if (qErr) throw qErr;
        const questionIds = (qRows || []).map((q: any) => String(q.id)).filter(Boolean);
        let optionsByQ = new Map<string, QuizDetailOption[]>();
        if (questionIds.length) {
          const { data: oRows, error: oErr } = await supabase
            .from('quiz_options')
            .select('id, question_id, option_text, explanation')
            .in('question_id', questionIds);
          if (oErr) throw oErr;
          for (const o of oRows || []) {
            const qid = String((o as any).question_id || '');
            if (!qid) continue;
            if (!optionsByQ.has(qid)) optionsByQ.set(qid, []);
            optionsByQ.get(qid)!.push({
              id: String((o as any).id || ''),
              option_text: String((o as any).option_text || ''),
              explanation: (o as any).explanation != null ? String((o as any).explanation) : null,
            });
          }
        }
        const questions: QuizDetailQuestion[] = (qRows || []).map((q: any) => ({
          id: String(q.id || ''),
          question_text: String(q.question_text || ''),
          order_index: q?.order_index ?? null,
          options: optionsByQ.get(String(q.id || '')) || [],
        }));
        setDetail({ challengeId, title, questions });
      } catch (e: any) {
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [canSeeAnswerKey, titles, user],
  );

  useEffect(() => {
    const challengeId = String(searchParams.get('quiz') || '').trim();
    if (!challengeId) return;
    if (didAutoOpenRef.current === challengeId) return;
    didAutoOpenRef.current = challengeId;
    void openQuizDetail(challengeId);
  }, [openQuizDetail, searchParams]);

  useEffect(() => {
    const challengeId = String(searchParams.get('quiz') || '').trim();
    const questionId = String(searchParams.get('question') || '').trim();
    if (!challengeId || !questionId) return;
    if (!detailOpen || detailLoading) return;
    if (!detail || String(detail.challengeId || '') !== challengeId) return;

    window.setTimeout(() => {
      try {
        const el = document.getElementById(`question-${questionId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        // ignore
      }
    }, 80);

    // Clear deep-link params to avoid reopening on back/close.
    const p = new URLSearchParams(searchParams);
    p.delete('quiz');
    p.delete('question');
    setSearchParams(p, { replace: true });
  }, [detail, detailLoading, detailOpen, searchParams, setSearchParams]);

  return (
    <Card id="quiz-history">
      <CardHeader>
        <CardTitle>Histórico de Quizzes</CardTitle>
        <CardDescription>Resumo por quiz, com opção de visualizar o quiz completo (inclui incompletos).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p>Carregando...</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Você ainda não respondeu quizzes.</p>
        )}

        {quizList.map((q) => {
          const total = q.totalQuestions || q.answeredCount;
          const correct = q.correctCount;
          const xp = q.xp;
          const lastAt = q.lastAnsweredAt;
          return (
            <div key={q.challengeId} className="border rounded-lg">
              <div className="flex items-center justify-between p-3">
                <div>
                  <p className="font-semibold text-sm">{q.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {q.answeredCount}/{total} respondidas • {correct}/{total} corretas • XP {xp}{' '}
                    {lastAt ? `• ${new Date(lastAt).toLocaleDateString(getActiveLocale())}` : ''}
                  </p>
                </div>
                <Badge variant={correct === total ? 'default' : 'secondary'}>
                  {Math.round((correct / Math.max(total, 1)) * 100)}%
                </Badge>
              </div>
              <div className="flex items-center justify-between px-3 pb-3">
                <span className="text-xs text-muted-foreground">
                  {q.answeredCount < total ? 'Quiz incompleto' : 'Quiz completo'}
                </span>
                <Button size="sm" variant="outline" onClick={() => openQuizDetail(q.challengeId)}>
                  Ver quiz completo
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={detailOpen} onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetail(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.title || 'Quiz'}</DialogTitle>
            <DialogDescription>
              {detailLoading ? 'Carregando…' : canSeeAnswerKey ? 'Inclui gabarito (curador/admin).' : 'Sem gabarito (perfil).'}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-3">
            {detailLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {!detailLoading && !detail && (
              <p className="text-sm text-muted-foreground">Não foi possível carregar este quiz agora.</p>
            )}
            {!detailLoading && detail?.questions?.length ? (
              <div className="space-y-4">
                {detail.questions.map((q, idx) => {
                  const ans = answersByQuestionId.get(q.id);
                  const selectedId = ans?.selected_option_id ? String(ans.selected_option_id) : '';
                  const answered = Boolean(selectedId);
                  const isCorrect = answered ? Boolean(ans?.is_correct) : null;
                  return (
                    <div key={q.id} id={`question-${q.id}`} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold">
                          {idx + 1}. {q.question_text}
                        </p>
                        {answered ? (
                          <Badge variant={isCorrect ? 'default' : 'destructive'}>{isCorrect ? 'Acertou' : 'Errou'}</Badge>
                        ) : (
                          <Badge variant="secondary">Não respondida</Badge>
                        )}
                      </div>
                      <div className="mt-2 space-y-1 text-sm">
                        {(q.options || []).map((o, oIdx) => {
                          const letter = String.fromCharCode(65 + oIdx);
                          const selected = selectedId && o.id === selectedId;
                          const correct = Boolean(o.is_correct);
                          const showCorrect = canSeeAnswerKey && o.is_correct != null;
                          return (
                            <div
                              key={o.id}
                              className={`rounded px-2 py-1 ${
                                selected
                                  ? 'bg-primary/10 border border-primary/30'
                                  : showCorrect && correct
                                    ? 'bg-emerald-500/10 border border-emerald-500/30'
                                    : 'border border-transparent'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm">
                                  <span className="font-mono text-xs mr-2">{letter}.</span>
                                  {o.option_text}
                                </p>
                                {showCorrect && correct && <Badge variant="outline">Correta</Badge>}
                                {selected && <Badge variant="secondary">Sua escolha</Badge>}
                              </div>
                              {selected && o.explanation && (
                                <p className="text-xs text-muted-foreground mt-1">{o.explanation}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
