import { Fragment, useEffect, useMemo, useState } from 'react';
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
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { getActiveLocale } from '@/lib/i18n/activeLocale';
import { Minus, Plus } from 'lucide-react';
import { QuizPeopleDrilldown } from '@/components/QuizPeopleDrilldown';

type Scope = 'team' | 'coord' | 'division' | 'all';
type Chas = 'C' | 'H' | 'A' | 'S';

type QuizRow = {
  challenge_id: string;
  title: string;
  chas_dimension?: Chas;
  quiz_specialties?: string[] | null;
  participants: number;
  attempts: number;
  avgScorePct: number | null;
};

type ThemeRow = {
  chas: Chas;
  label: string;
  quizzes: number;
  participants: number;
  participationRate: number;
  avgScorePct: number | null;
};

type UserRow = {
  user_id: string;
  name: string;
  team_id: string | null;
  is_leader: boolean;
  completedQuizzes: number;
  avgScorePct: number | null;
  byChas: Record<Chas, { completedQuizzes: number; avgScorePct: number | null }>;
};

type QuizSummary = {
  from: string;
  to: string;
  scope: Scope;
  scopeId: string | null;
  includeLeaders: boolean;
  includeGuests?: boolean;
  eligibleUsers: number;
  participants: number;
  participationRate: number;
  quizzes: QuizRow[];
  themes?: ThemeRow[];
  users?: UserRow[];
};

type AccessSummary = {
  from: string;
  to: string;
  scope: Scope;
  scopeId: string | null;
  includeLeaders: boolean;
  includeGuests?: boolean;
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
const daysAgoIso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(0, Math.floor(days)));
  return d.toISOString().slice(0, 10);
};

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
  const [includeGuests, setIncludeGuests] = useState(false);
  const [from, setFrom] = useState<string>(monthStartIso());
  const [to, setTo] = useState<string>(todayIso());
  const [expandedQuizIds, setExpandedQuizIds] = useState<Record<string, true>>({});

  const [quizSummary, setQuizSummary] = useState<QuizSummary | null>(null);
  const [accessSummary, setAccessSummary] = useState<AccessSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');

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
      qs.set('includeGuests', includeGuests ? '1' : '0');
      const resp = await apiFetch(`/api/admin?handler=reports-quiz-summary&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar relatório');
      setQuizSummary(json as QuizSummary);
    } catch (e: any) {
      console.error('ReportsHub: fetchQuizSummary failed', e);
      toast.error(String(e?.message || 'Falha ao carregar relatório'));
      setQuizSummary(null);
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
      qs.set('includeGuests', includeGuests ? '1' : '0');
      const resp = await apiFetch(`/api/admin?handler=reports-access-summary&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar acessos');
      setAccessSummary(json as AccessSummary);
    } catch (e: any) {
      console.error('ReportsHub: fetchAccessSummary failed', e);
      toast.error(String(e?.message || 'Falha ao carregar acessos'));
      setAccessSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'access') return;
    fetchQuizSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to, scope, scopeId, includeLeaders, includeGuests]);

  useEffect(() => {
    if (tab !== 'access') return;
    fetchAccessSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to, scope, scopeId, includeLeaders, includeGuests]);

  const quizOptions = useMemo(() => quizSummary?.quizzes || [], [quizSummary?.quizzes]);
  const themes = useMemo(() => (quizSummary?.themes || []) as ThemeRow[], [quizSummary?.themes]);
  const themeChartData = useMemo(
    () =>
      themes.map((t) => ({
        ...t,
        avgScorePct: t.avgScorePct ?? 0,
      })),
    [themes],
  );
  const themeChartConfig = useMemo(
    () => ({
      participationRate: { label: 'Aderência (%)', color: 'hsl(var(--secondary))' },
      avgScorePct: { label: 'Média acerto (%)', color: 'hsl(var(--accent))' },
    }),
    [],
  );
  const users = useMemo(() => (quizSummary?.users || []) as UserRow[], [quizSummary?.users]);
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.name || ''} ${u.team_id || ''}`.toLowerCase().includes(q));
  }, [userSearch, users]);

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
      qs.set('includeGuests', includeGuests ? '1' : '0');
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const resp = await apiFetch(`/api/admin?handler=reports-question-usage&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar perguntas');
      setQuestionUsage(json as QuestionUsage);
    } catch (e: any) {
      console.error('ReportsHub: loadQuestionUsage failed', e);
      toast.error(String(e?.message || 'Falha ao carregar perguntas'));
      setQuestionUsage(null);
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
            <Label>Atalhos</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => { setFrom(daysAgoIso(7)); setTo(todayIso()); }}>
                7 dias
              </Button>
              <Button type="button" variant="outline" onClick={() => { setFrom(daysAgoIso(30)); setTo(todayIso()); }}>
                30 dias
              </Button>
              <Button type="button" variant="outline" onClick={() => { setFrom(daysAgoIso(60)); setTo(todayIso()); }}>
                60 dias
              </Button>
              <Button type="button" variant="outline" onClick={() => { setFrom('2000-01-01'); setTo(todayIso()); }}>
                Tudo
              </Button>
            </div>
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
            {scope !== 'all' && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">ID do escopo</Label>
                <Input
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  placeholder={scope === 'team' ? 'Ex.: DJTB' : scope === 'coord' ? 'Ex.: DJTB-SAN' : 'Ex.: DJT'}
                  disabled={!canAll}
                />
                {!canAll && <div className="text-[11px] text-muted-foreground">Somente staff pode alterar.</div>}
              </div>
            )}
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex items-center gap-2">
                <Switch id="include-leaders" checked={includeLeaders} onCheckedChange={setIncludeLeaders} />
                <Label htmlFor="include-leaders" className="text-sm text-muted-foreground">
                  Incluir líderes nos cálculos (por padrão, exclui)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="include-guests" checked={includeGuests} onCheckedChange={setIncludeGuests} />
                <Label htmlFor="include-guests" className="text-sm text-muted-foreground">
                  Incluir convidados (CONVIDADOS/EXTERNO)
                </Label>
              </div>
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
                    chas: q.chas_dimension || '',
                    especialidades: Array.isArray(q.quiz_specialties) ? q.quiz_specialties.join(' | ') : '',
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
                      <TableHead className="w-[44px]"></TableHead>
                      <TableHead>Quiz</TableHead>
                      <TableHead>CHAS</TableHead>
                      <TableHead className="text-right">Participantes</TableHead>
                      <TableHead className="text-right">Média (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quizSummary.quizzes.map((q) => {
                      const expanded = Boolean(expandedQuizIds[q.challenge_id]);
                      return (
                        <Fragment key={q.challenge_id}>
                          <TableRow key={q.challenge_id}>
                            <TableCell className="align-top">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                aria-label={expanded ? 'Fechar detalhes' : 'Abrir detalhes'}
                                onClick={() =>
                                  setExpandedQuizIds((prev) => {
                                    const next = { ...prev };
                                    if (next[q.challenge_id]) delete next[q.challenge_id];
                                    else next[q.challenge_id] = true;
                                    return next;
                                  })
                                }
                              >
                                {expanded ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                              </Button>
                            </TableCell>
                            <TableCell className="font-medium">{q.title}</TableCell>
                            <TableCell>
                              {q.chas_dimension ? (
                                <Badge variant="outline" className="text-[10px]">
                                  {q.chas_dimension}
                                </Badge>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="text-right">{q.participants}</TableCell>
                            <TableCell className="text-right">{q.avgScorePct == null ? '—' : `${q.avgScorePct}%`}</TableCell>
                          </TableRow>
                          {expanded && (
                            <TableRow key={`${q.challenge_id}:details`}>
                              <TableCell colSpan={5} className="p-0">
                                <QuizPeopleDrilldown
                                  challengeId={q.challenge_id}
                                  scope={scope}
                                  scopeId={scopeId}
                                  includeLeaders={includeLeaders}
                                  includeGuests={includeGuests}
                                  from={from}
                                  to={to}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>Aderência por tema (CHAS)</CardTitle>
                <CardDescription>Participação (%) e média de acerto por dimensão</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const rows = themes.map((t) => ({
                    chas: t.chas,
                    tema: t.label,
                    quizzes: t.quizzes,
                    participantes: t.participants,
                    aderencia_pct: t.participationRate,
                    media_pct: t.avgScorePct ?? '',
                  }));
                  if (rows.length) downloadCsv(`relatorio-chas-${from}-a-${to}.csv`, rows);
                }}
                disabled={!themes.length}
              >
                Exportar CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {!themes.length ? (
                <p className="text-sm text-muted-foreground">Sem dados no período.</p>
              ) : (
                <>
                  <ChartContainer config={themeChartConfig} className="aspect-auto h-[260px] w-full">
                    <BarChart data={themeChartData} margin={{ left: 8, right: 8 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="chas" tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={30} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="participationRate" fill="var(--color-participationRate)" radius={4} />
                      <Bar dataKey="avgScorePct" fill="var(--color-avgScorePct)" radius={4} />
                    </BarChart>
                  </ChartContainer>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tema</TableHead>
                        <TableHead className="text-right">Quizzes</TableHead>
                        <TableHead className="text-right">Participantes</TableHead>
                        <TableHead className="text-right">Aderência (%)</TableHead>
                        <TableHead className="text-right">Média (%)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {themes.map((t) => (
                        <TableRow key={t.chas}>
                          <TableCell className="font-medium">{t.label}</TableCell>
                          <TableCell className="text-right">{t.quizzes}</TableCell>
                          <TableCell className="text-right">{t.participants}</TableCell>
                          <TableCell className="text-right">{t.participationRate}%</TableCell>
                          <TableCell className="text-right">{t.avgScorePct == null ? '—' : `${t.avgScorePct}%`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>Notas por pessoa</CardTitle>
                <CardDescription>Quizzes concluídos e média de acerto no período</CardDescription>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Buscar pessoa/equipe..."
                  className="w-full sm:w-64"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const rows = filteredUsers.map((u) => ({
                      user_id: u.user_id,
                      nome: u.name,
                      equipe: u.team_id ?? '',
                      lider: u.is_leader ? '1' : '0',
                      quizzes_concluidos: u.completedQuizzes,
                      media_pct: u.avgScorePct ?? '',
                      C_quizzes: u.byChas?.C?.completedQuizzes ?? 0,
                      C_media_pct: u.byChas?.C?.avgScorePct ?? '',
                      H_quizzes: u.byChas?.H?.completedQuizzes ?? 0,
                      H_media_pct: u.byChas?.H?.avgScorePct ?? '',
                      A_quizzes: u.byChas?.A?.completedQuizzes ?? 0,
                      A_media_pct: u.byChas?.A?.avgScorePct ?? '',
                      S_quizzes: u.byChas?.S?.completedQuizzes ?? 0,
                      S_media_pct: u.byChas?.S?.avgScorePct ?? '',
                    }));
                    if (rows.length) downloadCsv(`relatorio-notas-${from}-a-${to}.csv`, rows);
                  }}
                  disabled={!filteredUsers.length}
                >
                  Exportar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!users.length ? (
                <p className="text-sm text-muted-foreground">Sem dados no período.</p>
              ) : (
                <ScrollArea className="h-[460px] rounded-md border">
                  <div className="min-w-[860px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Pessoa</TableHead>
                          <TableHead>Equipe</TableHead>
                          <TableHead className="text-right">Concluídos</TableHead>
                          <TableHead className="text-right">Média (%)</TableHead>
                          <TableHead>CHAS</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.map((u) => (
                          <TableRow key={u.user_id}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="truncate">{u.name || u.user_id}</span>
                                {u.is_leader && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    Líder
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{u.team_id ?? '—'}</TableCell>
                            <TableCell className="text-right">{u.completedQuizzes}</TableCell>
                            <TableCell className="text-right">{u.avgScorePct == null ? '—' : `${u.avgScorePct}%`}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {(['C', 'H', 'A', 'S'] as const).map((c) => {
                                  const stat = u.byChas?.[c];
                                  const n = stat?.completedQuizzes ?? 0;
                                  const pct = stat?.avgScorePct;
                                  const label = pct == null ? `${c}:${n}` : `${c}:${n} • ${pct}%`;
                                  return (
                                    <Badge key={c} variant="outline" className="text-[10px]">
                                      {label}
                                    </Badge>
                                  );
                                })}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
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
                        <TableCell>{q.lastAnsweredAt ? new Date(q.lastAnsweredAt).toLocaleString(getActiveLocale()) : '—'}</TableCell>
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
