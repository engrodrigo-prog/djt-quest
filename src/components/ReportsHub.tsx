import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { TipDialogButton } from '@/components/TipDialogButton';
import { Switch } from '@/components/ui/switch';

type Scope = 'team' | 'coord' | 'division' | 'all';

type QuizRow = {
  challenge_id: string;
  title: string;
  participants: number;
  attempts: number;
  avgScorePct: number | null;
};

type QuizSummary = {
  from: string;
  to: string;
  scope: Scope;
  scopeId: string | null;
  includeLeaders: boolean;
  eligibleUsers: number;
  participants: number;
  participationRate: number;
  quizzes: QuizRow[];
};

type AccessSummary = {
  from: string;
  to: string;
  scope: Scope;
  scopeId: string | null;
  includeLeaders: boolean;
  eligibleUsers: number;
  totalEvents: number;
  daily: Array<{ day: string; count: number }>;
  lastSeen: Array<{ user_id: string; last_seen_at: string }>;
};

type QuestionUsage = {
  challengeId: string;
  from: string | null;
  to: string | null;
  totalQuestions: number;
  usedQuestions: number;
  unusedQuestions: number;
  questions: Array<{
    id: string;
    question_text: string;
    created_at: string | null;
    order_index: number;
    answeredCount: number;
    correctCount: number;
    accuracyPct: number | null;
    lastAnsweredAt: string | null;
  }>;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

function downloadCsv(filename: string, rows: Array<Record<string, any>>) {
  const headers = Object.keys(rows[0] || {});
  const escape = (v: any) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsHub() {
  const { orgScope, userRole } = useAuth() as any;
  const [tab, setTab] = useState<'quizzes' | 'questions' | 'access'>('quizzes');
  const [scope, setScope] = useState<Scope>('team');
  const [scopeId, setScopeId] = useState<string>('');
  const [includeLeaders, setIncludeLeaders] = useState(false);
  const [from, setFrom] = useState<string>(monthStartIso());
  const [to, setTo] = useState<string>(todayIso());

  const [quizSummary, setQuizSummary] = useState<QuizSummary | null>(null);
  const [accessSummary, setAccessSummary] = useState<AccessSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const canAll = userRole === 'admin' || String(userRole || '').includes('gerente') || String(userRole || '').includes('coordenador');

  useEffect(() => {
    const defaultScopeId = scope === 'team' ? orgScope?.teamId : scope === 'coord' ? orgScope?.coordId : orgScope?.divisionId;
    if (defaultScopeId) setScopeId(String(defaultScopeId));
  }, [orgScope?.coordId, orgScope?.divisionId, orgScope?.teamId, scope]);

  const scopeOptions = useMemo(() => {
    const opts: Array<{ value: Scope; label: string; id: string | null }> = [
      { value: 'team', label: 'Minha equipe', id: orgScope?.teamId || null },
      { value: 'coord', label: 'Minha coordenação', id: orgScope?.coordId || null },
      { value: 'division', label: 'Minha divisão', id: orgScope?.divisionId || null },
    ];
    if (canAll) opts.push({ value: 'all', label: 'Tudo (staff)', id: null });
    return opts;
  }, [canAll, orgScope?.coordId, orgScope?.divisionId, orgScope?.teamId]);

  const fetchQuizSummary = async () => {
    if (scope !== 'all' && !scopeId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('from', from);
      qs.set('to', to);
      qs.set('scope', scope);
      if (scope !== 'all') qs.set('scopeId', scopeId);
      qs.set('includeLeaders', includeLeaders ? '1' : '0');
      const resp = await apiFetch(`/api/admin?handler=reports-quiz-summary&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar relatório');
      setQuizSummary(json as QuizSummary);
    } finally {
      setLoading(false);
    }
  };

  const fetchAccessSummary = async () => {
    if (scope !== 'all' && !scopeId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('from', from);
      qs.set('to', to);
      qs.set('scope', scope);
      if (scope !== 'all') qs.set('scopeId', scopeId);
      qs.set('includeLeaders', includeLeaders ? '1' : '0');
      const resp = await apiFetch(`/api/admin?handler=reports-access-summary&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar acessos');
      setAccessSummary(json as AccessSummary);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuizSummary();
    // access: carrega só quando entrar na aba
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, scope, scopeId, includeLeaders]);

  useEffect(() => {
    if (tab === 'access') fetchAccessSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const quizOptions = useMemo(() => quizSummary?.quizzes || [], [quizSummary?.quizzes]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [questionUsage, setQuestionUsage] = useState<QuestionUsage | null>(null);
  const [allQuizzes, setAllQuizzes] = useState<Array<{ id: string; title: string; quiz_workflow_status?: string | null }>>([]);

  useEffect(() => {
    (async () => {
      try {
        const resp = await apiFetch('/api/admin?handler=reports-list-quizzes', { cache: 'no-store' });
        const json = await resp.json().catch(() => ({}));
        if (resp.ok) {
          setAllQuizzes(Array.isArray(json?.quizzes) ? json.quizzes : []);
        }
      } catch {
        setAllQuizzes([]);
      }
    })();
  }, []);

  const loadQuestionUsage = async () => {
    if (!selectedQuizId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('challengeId', selectedQuizId);
      qs.set('scope', scope);
      if (scope !== 'all') qs.set('scopeId', scopeId);
      qs.set('includeLeaders', includeLeaders ? '1' : '0');
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const resp = await apiFetch(`/api/admin?handler=reports-question-usage&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar perguntas');
      setQuestionUsage(json as QuestionUsage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-bold text-blue-50 mb-1">Relatórios</h2>
            <TipDialogButton tipId="studio-reports" ariaLabel="Entenda o hub de Relatórios" className="inline-flex items-center justify-center rounded-full border border-white/20 bg-black/20 p-1 text-blue-100/80 hover:bg-black/30 hover:text-blue-50" />
          </div>
          <p className="text-blue-100/80">Acompanhe quizzes e acessos com filtros por período</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Feche o mês (dia 1 → hoje) ou compare períodos</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Período (início)</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Período (fim)</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Escopo</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {scopeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={o.value !== 'all' && !o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ações</Label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => { setFrom(monthStartIso()); setTo(todayIso()); }}>
                Mês atual
              </Button>
              <Button type="button" onClick={() => { if (tab === 'access') fetchAccessSummary(); else fetchQuizSummary(); }} disabled={loading}>
                {loading ? 'Carregando...' : 'Atualizar'}
              </Button>
            </div>
          </div>
          <div className="space-y-2 md:col-span-4">
            <div className="flex items-center gap-2">
              <Switch id="include-leaders" checked={includeLeaders} onCheckedChange={setIncludeLeaders} />
              <Label htmlFor="include-leaders" className="text-sm text-muted-foreground">
                Incluir líderes nos cálculos (por padrão, exclui)
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid w-full grid-cols-3 lg:w-[560px]">
          <TabsTrigger value="quizzes">Quizzes</TabsTrigger>
          <TabsTrigger value="questions">Perguntas</TabsTrigger>
          <TabsTrigger value="access">Acessos</TabsTrigger>
        </TabsList>

        <TabsContent value="quizzes" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Elegíveis</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{quizSummary?.eligibleUsers ?? '—'}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Participantes</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{quizSummary?.participants ?? '—'}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Aderência (%)</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{quizSummary?.participationRate ?? '—'}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Resumo por quiz</CardTitle>
                <CardDescription>Participação e média de nota (% de acerto)</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const rows = (quizSummary?.quizzes || []).map((q) => ({
                    quiz_id: q.challenge_id,
                    quiz: q.title,
                    participantes: q.participants,
                    tentativas: q.attempts,
                    media_pct: q.avgScorePct ?? '',
                  }));
                  if (rows.length) downloadCsv(`relatorio-quizzes-${from}-a-${to}.csv`, rows);
                }}
                disabled={!quizSummary?.quizzes?.length}
              >
                Exportar CSV
              </Button>
            </CardHeader>
            <CardContent>
              {!quizSummary?.quizzes?.length ? (
                <p className="text-sm text-muted-foreground">Sem dados no período.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quiz</TableHead>
                      <TableHead className="text-right">Participantes</TableHead>
                      <TableHead className="text-right">Média (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quizSummary.quizzes.map((q) => (
                      <TableRow key={q.challenge_id}>
                        <TableCell className="font-medium">{q.title}</TableCell>
                        <TableCell className="text-right">{q.participants}</TableCell>
                        <TableCell className="text-right">{q.avgScorePct == null ? '—' : `${q.avgScorePct}%`}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="questions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Perguntas</CardTitle>
              <CardDescription>Veja quais perguntas já foram usadas e quais ainda não foram aplicadas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="space-y-2 md:col-span-2">
                  <Label>Quiz</Label>
                  <Select value={selectedQuizId} onValueChange={setSelectedQuizId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um quiz" />
                    </SelectTrigger>
                    <SelectContent>
                      {(allQuizzes.length ? allQuizzes : quizOptions.map((q) => ({ id: q.challenge_id, title: q.title }))).map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={loadQuestionUsage} disabled={!selectedQuizId || loading}>
                  {loading ? 'Carregando...' : 'Carregar'}
                </Button>
              </div>

              {questionUsage && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium">Total de perguntas</CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-bold">{questionUsage.totalQuestions}</CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium">Aplicadas</CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-bold">{questionUsage.usedQuestions}</CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium">Não utilizadas</CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-bold">{questionUsage.unusedQuestions}</CardContent>
                  </Card>
                </div>
              )}

              {questionUsage?.questions?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pergunta</TableHead>
                      <TableHead className="text-right">Respostas</TableHead>
                      <TableHead className="text-right">Acerto (%)</TableHead>
                      <TableHead>Último uso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {questionUsage.questions.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="max-w-[520px] truncate" title={q.question_text}>
                          {q.question_text}
                        </TableCell>
                        <TableCell className="text-right">{q.answeredCount}</TableCell>
                        <TableCell className="text-right">{q.accuracyPct == null ? '—' : `${q.accuracyPct}%`}</TableCell>
                        <TableCell>{q.lastAnsweredAt ? new Date(q.lastAnsweredAt).toLocaleString('pt-BR') : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Selecione um quiz e carregue o histórico.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Acessos</CardTitle>
              <CardDescription>Baseado em eventos de acesso (best-effort) registrados na plataforma</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Elegíveis</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-bold">{accessSummary?.eligibleUsers ?? '—'}</CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Eventos no período</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-bold">{accessSummary?.totalEvents ?? '—'}</CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Período</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">{from} → {to}</CardContent>
                </Card>
              </div>

              {accessSummary?.daily?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dia</TableHead>
                      <TableHead className="text-right">Acessos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accessSummary.daily.map((d) => (
                      <TableRow key={d.day}>
                        <TableCell>{d.day}</TableCell>
                        <TableCell className="text-right">{d.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem dados. Se acabou de habilitar, aguarde novos acessos (o registro é best-effort).
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
