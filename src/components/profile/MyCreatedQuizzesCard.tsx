import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type MyQuizRow = {
  id: string;
  title: string;
  created_at: string | null;
  quiz_workflow_status: string | null;
  published_at: string | null;
  approved_at: string | null;
};

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');

export function MyCreatedQuizzesCard() {
  const { user, isContentCurator, userRole } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MyQuizRow[]>([]);

  const canOpenStudio = useMemo(() => Boolean(isContentCurator || userRole === 'admin' || userRole === 'gerente_djt'), [isContentCurator, userRole]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('challenges')
          .select('id, title, created_at, quiz_workflow_status, published_at, approved_at')
          .eq('type', 'quiz')
          .or(`created_by.eq.${user.id},owner_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(20);
        if (error) throw error;
        if (active) setRows((data || []) as any);
      } catch {
        if (active) setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <Card id="my-quizzes">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Quizzes Criados</CardTitle>
          <CardDescription>Rascunhos, submetidos e publicados</CardDescription>
        </div>
        {canOpenStudio && (
          <Button size="sm" variant="outline" onClick={() => navigate('/studio/curadoria')}>
            Curadoria
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground">Você ainda não criou quizzes.</p>}
        {rows.map((q) => (
          <div key={q.id} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{q.title}</p>
                <p className="text-xs text-muted-foreground">
                  Criado: {fmt(q.created_at)} • Aprovado: {fmt(q.approved_at)} • Publicado: {fmt(q.published_at)}
                </p>
              </div>
              <Badge variant="secondary">{q.quiz_workflow_status || '—'}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
