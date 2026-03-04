import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { getActiveLocale } from '@/lib/i18n/activeLocale';

type Scope = 'team' | 'coord' | 'division' | 'all';
type Sort = 'score_desc' | 'submitted_desc' | 'name_asc';
type PeopleViewMode = 'all' | 'completed' | 'pending';

type AttemptRow = {
  user_id: string;
  name: string;
  team_id: string | null;
  is_leader?: boolean;
  submitted_at: string | null;
  score: number;
  max_score: number;
  scorePct: number | null;
};

type EligibleRow = {
  id: string;
  name: string;
  team_id: string | null;
  is_leader: boolean;
};

type AttemptsPayload = {
  challengeId: string;
  from?: string | null;
  to?: string | null;
  scope: Scope;
  scopeId: string | null;
  includeLeaders: boolean;
  includeGuests: boolean;
  sort: Sort;
  eligibleUsers: number;
  participants: number;
  participationRate: number;
  avgScorePct: number | null;
  attempts: AttemptRow[];
  eligible?: EligibleRow[];
};

type UserDetailQuestion = {
  id: string;
  question_text: string;
  order_index: number | null;
  selected_option_id: string | null;
  is_correct: boolean | null;
  answered_at: string | null;
  options: Array<{
    id: string;
    option_text: string;
    explanation: string | null;
    is_correct: boolean;
  }>;
};

type UserQuizDetail = {
  challengeId: string;
  title: string;
  user: EligibleRow;
  questions: UserDetailQuestion[];
};

type QuestionUsage = {
  challengeId: string;
  from: string | null;
  to: string | null;
  scope: Scope;
  scopeId: string | null;
  includeLeaders: boolean;
  includeGuests?: boolean;
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

function safePct(n: number | null | undefined) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

export function QuizAnalyticsFull({ challengeId }: { challengeId: string }) {
  const { orgScope, userRole, profile, isLeader } = useAuth() as any;
  const canAll = Boolean(isLeader) || userRole === 'admin' || String(userRole || '').includes('gerente') || String(userRole || '').includes('coordenador');

  const [tab, setTab] = useState<'people' | 'teams' | 'questions'>('teams');
  const [loading, setLoading] = useState(false);

  const [scope, setScope] = useState<Scope>(() => (canAll ? 'all' : 'team'));
  const [scopeId, setScopeId] = useState<string>('');
  const [includeLeaders, setIncludeLeaders] = useState(true);
  const [includeGuests, setIncludeGuests] = useState(false);
  const [sort, setSort] = useState<Sort>('score_desc');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [peopleView, setPeopleView] = useState<PeopleViewMode>('all');

  const [attemptsPayload, setAttemptsPayload] = useState<AttemptsPayload | null>(null);
  const [questionUsage, setQuestionUsage] = useState<QuestionUsage | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [userDetailError, setUserDetailError] = useState<string | null>(null);
  const [userDetailTarget, setUserDetailTarget] = useState<AttemptRow | null>(null);
  const [userDetail, setUserDetail] = useState<UserQuizDetail | null>(null);

  const scopeIds = useMemo(() => {
    const teamId = orgScope?.teamId ?? profile?.team_id ?? profile?.teamId ?? null;
    const coordId = orgScope?.coordId ?? profile?.coord_id ?? profile?.coordId ?? null;
    const divisionId = orgScope?.divisionId ?? profile?.division_id ?? profile?.divisionId ?? null;
    return {
      teamId: teamId != null ? String(teamId) : null,
      coordId: coordId != null ? String(coordId) : null,
      divisionId: divisionId != null ? String(divisionId) : null,
    };
  }, [orgScope?.coordId, orgScope?.divisionId, orgScope?.teamId, profile?.coordId, profile?.coord_id, profile?.divisionId, profile?.division_id, profile?.teamId, profile?.team_id]);

  const scopeOptions = useMemo(() => {
    const opts: Array<{ value: Scope; label: string; id: string | null }> = [
      { value: 'team', label: 'Minha equipe', id: scopeIds.teamId || null },
      { value: 'coord', label: 'Minha coordenação', id: scopeIds.coordId || null },
      { value: 'division', label: 'Minha divisão', id: scopeIds.divisionId || null },
    ];
    if (canAll) opts.push({ value: 'all', label: 'Tudo', id: null });
    return opts;
  }, [canAll, scopeIds.coordId, scopeIds.divisionId, scopeIds.teamId]);

  useEffect(() => {
    if (!canAll) return;
    setScope((current) => (current === 'team' ? 'all' : current));
  }, [canAll]);

  useEffect(() => {
    const defaultScopeId =
      scope === 'team' ? scopeIds.teamId : scope === 'coord' ? scopeIds.coordId : scope === 'division' ? scopeIds.divisionId : null;
    setScopeId(defaultScopeId ? String(defaultScopeId) : '');
  }, [scope, scopeIds.coordId, scopeIds.divisionId, scopeIds.teamId]);

  const effectiveScopeId = scope === 'all' ? null : (scopeId || null);

  const refreshAttempts = async () => {
    if (scope !== 'all' && !effectiveScopeId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('challengeId', challengeId);
      qs.set('scope', scope);
      if (scope !== 'all' && effectiveScopeId) qs.set('scopeId', effectiveScopeId);
      qs.set('includeLeaders', includeLeaders ? '1' : '0');
      qs.set('includeGuests', includeGuests ? '1' : '0');
      qs.set('sort', sort);
      qs.set('includeEligible', '1');
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);

      const resp = await apiFetch(`/api/admin?handler=reports-quiz-attempts&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar relatório');
      setAttemptsPayload(json as AttemptsPayload);
    } catch (e: any) {
      console.error('QuizAnalyticsFull: refreshAttempts failed', e);
      toast.error(String(e?.message || 'Falha ao carregar relatório'));
      setAttemptsPayload(null);
    } finally {
      setLoading(false);
    }
  };

  const refreshQuestions = async () => {
    if (scope !== 'all' && !effectiveScopeId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('challengeId', challengeId);
      qs.set('scope', scope);
      if (scope !== 'all' && effectiveScopeId) qs.set('scopeId', effectiveScopeId);
      qs.set('includeLeaders', includeLeaders ? '1' : '0');
      qs.set('includeGuests', includeGuests ? '1' : '0');
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);

      const resp = await apiFetch(`/api/admin?handler=reports-question-usage&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar perguntas');
      setQuestionUsage(json as QuestionUsage);
    } catch (e: any) {
      console.error('QuizAnalyticsFull: refreshQuestions failed', e);
      toast.error(String(e?.message || 'Falha ao carregar perguntas'));
      setQuestionUsage(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAttempts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId, scope, effectiveScopeId, includeLeaders, includeGuests, sort, from, to]);

  useEffect(() => {
    if (tab !== 'questions') return;
    refreshQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, challengeId, scope, effectiveScopeId, includeLeaders, includeGuests, from, to]);

  useEffect(() => {
    setUserDetail(null);
    setUserDetailError(null);
    setUserDetailTarget(null);
    setUserDetailLoading(false);
  }, [challengeId, scope, effectiveScopeId, includeLeaders, includeGuests, from, to]);

  const attempts = useMemo(() => attemptsPayload?.attempts || [], [attemptsPayload?.attempts]);
  const eligible = useMemo(() => attemptsPayload?.eligible || [], [attemptsPayload?.eligible]);

  const attemptByUserId = useMemo(() => {
    const m = new Map<string, AttemptRow>();
    for (const a of attempts) {
      if (a?.user_id) m.set(String(a.user_id), a);
    }
    return m;
  }, [attempts]);

  const pending = useMemo(() => {
    if (!eligible.length) return [];
    return eligible.filter((e) => !attemptByUserId.has(String(e.id)));
  }, [attemptByUserId, eligible]);

  const filteredAttempts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const t = teamFilter.trim().toLowerCase();
    const base = attempts;
    return base.filter((a) => {
      const name = String(a?.name || '').toLowerCase();
      const team = String(a?.team_id || '').toLowerCase();
      if (t && !team.includes(t)) return false;
      if (!q) return true;
      return name.includes(q) || team.includes(q);
    });
  }, [attempts, search, teamFilter]);

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase();
    const t = teamFilter.trim().toLowerCase();
    const base = pending;
    return base.filter((p) => {
      const name = String(p?.name || '').toLowerCase();
      const team = String(p?.team_id || '').toLowerCase();
      if (t && !team.includes(t)) return false;
      if (!q) return true;
      return name.includes(q) || team.includes(q);
    });
  }, [pending, search, teamFilter]);

  const teamRows = useMemo(() => {
    const stats = new Map<
      string,
      { team_id: string; eligible: number; participants: number; participationRate: number; avgScorePct: number | null }
    >();

    const ensure = (teamId: string) => {
      const k = teamId || '—';
      const got = stats.get(k);
      if (got) return got;
      const row = { team_id: k, eligible: 0, participants: 0, participationRate: 0, avgScorePct: null as number | null };
      stats.set(k, row);
      return row;
    };

    for (const e of eligible) {
      const teamId = e?.team_id ? String(e.team_id) : '—';
      ensure(teamId).eligible += 1;
    }

    const byTeamSum = new Map<string, { sum: number; n: number }>();
    for (const a of attempts) {
      const teamId = a?.team_id ? String(a.team_id) : '—';
      ensure(teamId).participants += 1;
      const pct = safePct(a.scorePct);
      if (pct != null) {
        const agg = byTeamSum.get(teamId) || { sum: 0, n: 0 };
        agg.sum += pct;
        agg.n += 1;
        byTeamSum.set(teamId, agg);
      }
    }

    const out = Array.from(stats.values()).map((r) => {
      const agg = byTeamSum.get(r.team_id === '—' ? '—' : r.team_id);
      const avg = agg && agg.n > 0 ? Math.round((agg.sum / agg.n) * 10) / 10 : null;
      const pr = r.eligible > 0 ? Math.round((r.participants / r.eligible) * 1000) / 10 : 0;
      return { ...r, avgScorePct: avg, participationRate: pr };
    });

    const q = teamFilter.trim().toLowerCase();
    const filtered = q ? out.filter((r) => String(r.team_id).toLowerCase().includes(q)) : out;
    filtered.sort((a, b) => b.participationRate - a.participationRate || (Number(b.avgScorePct ?? -1) - Number(a.avgScorePct ?? -1)) || String(a.team_id).localeCompare(String(b.team_id), getActiveLocale()));
    return filtered;
  }, [attempts, eligible, teamFilter]);

  const questionRows = useMemo(() => {
    const qs = questionUsage?.questions || [];
    return [...qs].sort((a, b) => {
      const ao = Number.isFinite(Number(a.order_index)) ? Number(a.order_index) : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(Number(b.order_index)) ? Number(b.order_index) : Number.MAX_SAFE_INTEGER;
      return ao - bo || String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  }, [questionUsage?.questions]);

  const pendingCount = useMemo(() => {
    const total = Number(attemptsPayload?.eligibleUsers ?? 0) || 0;
    const participants = Number(attemptsPayload?.participants ?? 0) || 0;
    return Math.max(0, total - participants);
  }, [attemptsPayload?.eligibleUsers, attemptsPayload?.participants]);
  const answeredCountForSelectedUser = useMemo(
    () => (userDetail?.questions || []).filter((q) => q.selected_option_id).length,
    [userDetail?.questions],
  );

  const showCompleted = peopleView !== 'pending';
  const showPending = peopleView !== 'completed';

  const openUserDetail = async (row: AttemptRow) => {
    setUserDetailTarget(row);
    setUserDetailLoading(true);
    setUserDetailError(null);
    setUserDetail(null);
    try {
      const qs = new URLSearchParams();
      qs.set('challengeId', challengeId);
      qs.set('targetUserId', row.user_id);
      qs.set('scope', scope);
      if (scope !== 'all' && effectiveScopeId) qs.set('scopeId', effectiveScopeId);
      qs.set('includeLeaders', includeLeaders ? '1' : '0');
      qs.set('includeGuests', includeGuests ? '1' : '0');
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);

      const resp = await apiFetch(`/api/admin?handler=reports-quiz-user-detail&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar respostas do colaborador');
      setUserDetail(json as UserQuizDetail);
    } catch (e: any) {
      console.error('QuizAnalyticsFull: openUserDetail failed', e);
      setUserDetailError(String(e?.message || 'Falha ao carregar respostas do colaborador'));
      setUserDetail(null);
    } finally {
      setUserDetailLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Aderência, notas e temas</CardTitle>
              <CardDescription>
                Ranking por colaborador, visão por equipe e todas as perguntas do quiz para orientar capacitação
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={refreshAttempts} disabled={loading}>
                {loading ? 'Carregando…' : 'Atualizar'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const today = todayIso();
                  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
                  setFrom(monthStart);
                  setTo(today);
                }}
              >
                Mês atual
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
              >
                Tudo
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>Período (início, opcional)</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Período (fim, opcional)</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
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
            <div className="space-y-1">
              <Label>Ordenação</Label>
              <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                  <SelectContent>
                  <SelectItem value="score_desc">Score (maior → menor)</SelectItem>
                  <SelectItem value="submitted_desc">Última resposta (mais recente)</SelectItem>
                  <SelectItem value="name_asc">Nome (A → Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex items-center gap-2">
                <Switch id="qa-inc-leaders" checked={includeLeaders} onCheckedChange={setIncludeLeaders} />
                <Label htmlFor="qa-inc-leaders" className="text-sm text-muted-foreground">
                  Incluir líderes
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="qa-inc-guests" checked={includeGuests} onCheckedChange={setIncludeGuests} />
                <Label htmlFor="qa-inc-guests" className="text-sm text-muted-foreground">
                  Incluir convidados
                </Label>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Label className="text-sm text-muted-foreground">Mostrar</Label>
                <div className="inline-flex items-center rounded-md border p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={peopleView === 'pending' ? 'secondary' : 'ghost'}
                    className="h-7 px-2"
                    onClick={() => setPeopleView('pending')}
                  >
                    Pendentes
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={peopleView === 'completed' ? 'secondary' : 'ghost'}
                    className="h-7 px-2"
                    onClick={() => setPeopleView('completed')}
                  >
                    Concluídos
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={peopleView === 'all' ? 'secondary' : 'ghost'}
                    className="h-7 px-2"
                    onClick={() => setPeopleView('all')}
                  >
                    Tudo
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Input placeholder="Buscar por nome…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Input placeholder="Filtrar equipe (sigla)..." value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">Elegíveis: {attemptsPayload?.eligibleUsers ?? '—'}</Badge>
            <Badge variant="outline">Participantes: {attemptsPayload?.participants ?? '—'}</Badge>
            <Badge variant="outline">Pendentes: {attemptsPayload ? pendingCount : '—'}</Badge>
            <Badge variant="outline">Aderência: {attemptsPayload?.participationRate ?? '—'}%</Badge>
            <Badge variant="outline">Média (%): {attemptsPayload?.avgScorePct == null ? '—' : `${attemptsPayload.avgScorePct}%`}</Badge>
          </div>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid w-full grid-cols-3 lg:w-[560px]">
          <TabsTrigger value="people">Colaboradores</TabsTrigger>
          <TabsTrigger value="teams">Equipes</TabsTrigger>
          <TabsTrigger value="questions">Perguntas</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Ranking por colaborador</CardTitle>
              <CardDescription>Use o seletor para ver concluídos, pendentes ou tudo</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!attemptsPayload ? (
                <p className="text-sm text-muted-foreground">Carregue o relatório para ver os dados.</p>
              ) : (
                <div className="space-y-4">
                  {(userDetailLoading || userDetailError || userDetail) && (
                    <div className="rounded-lg border p-4 space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">
                            {userDetail?.user?.name || userDetailTarget?.name || userDetailTarget?.user_id || 'Colaborador'}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{userDetail?.title || 'Quiz'}</span>
                            {(userDetail?.user?.team_id || userDetailTarget?.team_id) ? (
                              <span>Equipe: {userDetail?.user?.team_id || userDetailTarget?.team_id}</span>
                            ) : null}
                            {userDetail?.user?.is_leader || userDetailTarget?.is_leader ? <span>Líder</span> : null}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setUserDetail(null);
                            setUserDetailError(null);
                            setUserDetailTarget(null);
                            setUserDetailLoading(false);
                          }}
                        >
                          Fechar detalhe
                        </Button>
                      </div>

                      {userDetailLoading && <p className="text-sm text-muted-foreground">Carregando respostas…</p>}
                      {userDetailError && <p className="text-sm text-destructive">{userDetailError}</p>}

                      {!userDetailLoading && !userDetailError && userDetail && (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">Perguntas: {userDetail.questions.length}</Badge>
                            <Badge variant="outline">Respondidas: {answeredCountForSelectedUser}</Badge>
                            <Badge variant="outline">
                              Corretas: {userDetail.questions.filter((q) => q.is_correct === true).length}
                            </Badge>
                            <Badge variant="outline">
                              Erradas: {userDetail.questions.filter((q) => q.is_correct === false).length}
                            </Badge>
                          </div>

                          <ScrollArea className="h-[360px] pr-3">
                            <div className="space-y-3">
                              {userDetail.questions.map((q, idx) => (
                                <div key={q.id} className="rounded-md border p-3">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold">
                                        {idx + 1}. {q.question_text}
                                      </p>
                                      {q.answered_at ? (
                                        <p className="text-[11px] text-muted-foreground">
                                          {new Date(q.answered_at).toLocaleString(getActiveLocale())}
                                        </p>
                                      ) : null}
                                    </div>
                                    {q.selected_option_id ? (
                                      <Badge variant={q.is_correct ? 'default' : 'destructive'}>
                                        {q.is_correct ? 'Acertou' : 'Errou'}
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary">Não respondeu</Badge>
                                    )}
                                  </div>

                                  <div className="mt-3 space-y-2">
                                    {(q.options || []).map((option, optionIdx) => {
                                      const letter = String.fromCharCode(65 + optionIdx);
                                      const selected = q.selected_option_id && option.id === q.selected_option_id;
                                      const correct = Boolean(option.is_correct);
                                      return (
                                        <div
                                          key={option.id}
                                          className={`rounded-md border px-3 py-2 ${
                                            selected
                                              ? 'border-primary/40 bg-primary/10'
                                              : correct
                                                ? 'border-emerald-500/30 bg-emerald-500/10'
                                                : 'border-border/60'
                                          }`}
                                        >
                                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <p className="text-sm min-w-0">
                                              <span className="font-mono text-xs mr-2">{letter}.</span>
                                              {option.option_text}
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                              {correct && <Badge variant="outline">Correta</Badge>}
                                              {selected && <Badge variant="secondary">Escolhida</Badge>}
                                            </div>
                                          </div>
                                          {selected && option.explanation ? (
                                            <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
                                              {option.explanation}
                                            </p>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4">
                  {showCompleted && (
                    <div className="space-y-2 min-w-0">
                      <div className="text-sm font-medium">Concluídos ({filteredAttempts.length})</div>
                      <ScrollArea className="h-[380px] pr-3">
                        {filteredAttempts.length === 0 ? (
                          <div className="text-sm text-muted-foreground">Sem concluídos no filtro atual.</div>
                        ) : (
                          <div className="space-y-2">
                            {filteredAttempts.map((row, idx) => {
                              const pct = typeof row.scorePct === 'number' ? Math.round(row.scorePct) : null;
                              const when = row.submitted_at ? new Date(row.submitted_at).toLocaleString(getActiveLocale()) : '';
                              return (
                                <div key={row.user_id} className="rounded-md border p-3">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <Badge variant="outline" className="text-[10px] flex-shrink-0">
                                          #{idx + 1}
                                        </Badge>
                                        <button
                                          type="button"
                                          className="truncate font-medium text-left underline-offset-2 hover:underline"
                                          onClick={() => {
                                            void openUserDetail(row);
                                          }}
                                        >
                                          {row.name || row.user_id}
                                        </button>
                                        {row.is_leader && (
                                          <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                                            Líder
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                        <span>{row.team_id ? `Equipe: ${row.team_id}` : 'Sem equipe'}</span>
                                        {when ? <span>{when}</span> : null}
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                      <Badge variant="outline" className="text-[10px]">
                                        {row.score}/{row.max_score || 0}
                                      </Badge>
                                      <Badge
                                        variant={
                                          pct == null ? 'secondary' : pct >= 70 ? 'default' : pct >= 40 ? 'secondary' : 'destructive'
                                        }
                                        className="text-[10px]"
                                      >
                                        {pct == null ? '—' : `${pct}%`}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  )}

                  {showPending && (
                    <div className="space-y-2 min-w-0">
                      <div className="text-sm font-medium">Pendentes ({filteredPending.length})</div>
                      <ScrollArea className="h-[380px] pr-3">
                        {filteredPending.length === 0 ? (
                          <div className="text-sm text-muted-foreground">Sem pendentes no filtro atual.</div>
                        ) : (
                          <div className="space-y-2">
                            {filteredPending.map((p) => (
                              <div key={p.id} className="rounded-md border p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="truncate font-medium">{p.name || p.id}</span>
                                      {p.is_leader && (
                                        <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                                          Líder
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-[10px] w-fit">
                                    {p.team_id ? `Equipe: ${p.team_id}` : 'Sem equipe'}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Ranking por equipe</CardTitle>
              <CardDescription>Aderência e média de acerto por equipe (no escopo selecionado)</CardDescription>
            </CardHeader>
            <CardContent>
              {!attemptsPayload ? (
                <p className="text-sm text-muted-foreground">Carregue o relatório para ver os dados.</p>
              ) : (
                <ScrollArea className="h-[460px] pr-3">
                  {teamRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem dados no filtro atual.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Equipe</TableHead>
                          <TableHead className="text-right">Elegíveis</TableHead>
                          <TableHead className="text-right">Participantes</TableHead>
                          <TableHead className="text-right">Aderência</TableHead>
                          <TableHead className="text-right">Média</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teamRows.map((r) => (
                          <TableRow key={r.team_id}>
                            <TableCell className="font-medium">{r.team_id}</TableCell>
                            <TableCell className="text-right">{r.eligible}</TableCell>
                            <TableCell className="text-right">{r.participants}</TableCell>
                            <TableCell className="text-right">{r.participationRate}%</TableCell>
                            <TableCell className="text-right">{r.avgScorePct == null ? '—' : `${r.avgScorePct}%`}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="questions" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>Perguntas e respostas do quiz</CardTitle>
                <CardDescription>Exibe todas as perguntas com volume de respostas e taxa de acerto</CardDescription>
              </div>
              <Button type="button" variant="outline" onClick={refreshQuestions} disabled={loading}>
                {loading ? 'Carregando…' : 'Atualizar'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {!questionUsage ? (
                <p className="text-sm text-muted-foreground">Carregue a aba para ver as perguntas.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline">Total: {questionUsage.totalQuestions}</Badge>
                    <Badge variant="outline">Aplicadas: {questionUsage.usedQuestions}</Badge>
                    <Badge variant="outline">Não usadas: {questionUsage.unusedQuestions}</Badge>
                  </div>

                  <ScrollArea className="h-[460px] pr-3">
                    {questionRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sem dados de respostas no período.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[70px]">#</TableHead>
                            <TableHead>Pergunta</TableHead>
                            <TableHead className="text-right">Respostas</TableHead>
                            <TableHead className="text-right">Acerto</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {questionRows.map((q) => (
                            <TableRow key={q.id}>
                              <TableCell className="font-medium">{(q.order_index ?? 0) + 1}</TableCell>
                              <TableCell className="min-w-0">
                                <div className="line-clamp-3">{q.question_text}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  Corretas: {q.correctCount}/{q.answeredCount}
                                </div>
                                {q.lastAnsweredAt && (
                                  <div className="text-[11px] text-muted-foreground">
                                    Última resposta: {new Date(q.lastAnsweredAt).toLocaleString(getActiveLocale())}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">{q.answeredCount}</TableCell>
                              <TableCell className="text-right">
                                {q.accuracyPct == null ? '—' : (
                                  <Badge
                                    variant={q.accuracyPct >= 70 ? 'default' : q.accuracyPct >= 40 ? 'secondary' : 'destructive'}
                                  >
                                    {q.accuracyPct}%
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </ScrollArea>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
