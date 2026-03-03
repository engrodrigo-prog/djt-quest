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
  const { orgScope, userRole, profile } = useAuth() as any;

  const [tab, setTab] = useState<'people' | 'teams' | 'questions'>('teams');
  const [loading, setLoading] = useState(false);

  const [scope, setScope] = useState<Scope>('team');
  const [scopeId, setScopeId] = useState<string>('');
  const [includeLeaders, setIncludeLeaders] = useState(false);
  const [includeGuests, setIncludeGuests] = useState(false);
  const [sort, setSort] = useState<Sort>('score_desc');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);

  const [attemptsPayload, setAttemptsPayload] = useState<AttemptsPayload | null>(null);
  const [questionUsage, setQuestionUsage] = useState<QuestionUsage | null>(null);

  const canAll = userRole === 'admin' || String(userRole || '').includes('gerente') || String(userRole || '').includes('coordenador');

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
    if (canAll) opts.push({ value: 'all', label: 'Tudo (staff)', id: null });
    return opts;
  }, [canAll, scopeIds.coordId, scopeIds.divisionId, scopeIds.teamId]);

  useEffect(() => {
    if (!canAll) return;
    if (scopeIds.teamId || scopeIds.coordId || scopeIds.divisionId) return;
    if (scope !== 'all') setScope('all');
  }, [canAll, scope, scopeIds.coordId, scopeIds.divisionId, scopeIds.teamId]);

  useEffect(() => {
    const defaultScopeId = scope === 'team' ? scopeIds.teamId : scope === 'coord' ? scopeIds.coordId : scopeIds.divisionId;
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

  const worstQuestions = useMemo(() => {
    const qs = questionUsage?.questions || [];
    const out = [...qs].sort((a, b) => {
      const ap = typeof a.accuracyPct === 'number' ? a.accuracyPct : 101;
      const bp = typeof b.accuracyPct === 'number' ? b.accuracyPct : 101;
      return ap - bp || b.answeredCount - a.answeredCount;
    });
    return out.slice(0, 12);
  }, [questionUsage?.questions]);

  const pendingCount = useMemo(() => {
    const total = Number(attemptsPayload?.eligibleUsers ?? 0) || 0;
    const participants = Number(attemptsPayload?.participants ?? 0) || 0;
    return Math.max(0, total - participants);
  }, [attemptsPayload?.eligibleUsers, attemptsPayload?.participants]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Aderência, notas e temas</CardTitle>
              <CardDescription>
                Ranking por colaborador, visão por equipe e perguntas com menor acerto (para orientar capacitação)
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
                  <SelectItem value="submitted_desc">Envio (mais recente)</SelectItem>
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
              <div className="flex items-center gap-2">
                <Switch id="qa-pending-only" checked={pendingOnly} onCheckedChange={setPendingOnly} />
                <Label htmlFor="qa-pending-only" className="text-sm text-muted-foreground">
                  Somente pendentes
                </Label>
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
              <CardDescription>Participantes ranqueados + lista de pendentes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!attemptsPayload ? (
                <p className="text-sm text-muted-foreground">Carregue o relatório para ver os dados.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Participantes ({filteredAttempts.length})</div>
                    <ScrollArea className="h-[380px] pr-3">
                      {pendingOnly ? (
                        <div className="text-sm text-muted-foreground">Ative “Somente pendentes” desabilita esta lista.</div>
                      ) : filteredAttempts.length === 0 ? (
                        <div className="text-sm text-muted-foreground">Sem participantes no filtro atual.</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[70px]">Rank</TableHead>
                              <TableHead>Pessoa</TableHead>
                              <TableHead>Equipe</TableHead>
                              <TableHead className="text-right">Nota</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredAttempts.map((row, idx) => {
                              const pct = typeof row.scorePct === 'number' ? Math.round(row.scorePct) : null;
                              const when = row.submitted_at ? new Date(row.submitted_at).toLocaleString(getActiveLocale()) : '';
                              return (
                                <TableRow key={row.user_id}>
                                  <TableCell className="font-medium">{idx + 1}</TableCell>
                                  <TableCell className="min-w-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="truncate">{row.name || row.user_id}</span>
                                      {row.is_leader && (
                                        <Badge variant="secondary" className="text-[10px]">
                                          Líder
                                        </Badge>
                                      )}
                                    </div>
                                    {when && <div className="text-[11px] text-muted-foreground truncate">{when}</div>}
                                  </TableCell>
                                  <TableCell>{row.team_id ?? '—'}</TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
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
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </ScrollArea>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Pendentes ({filteredPending.length})</div>
                    <ScrollArea className="h-[380px] pr-3">
                      {filteredPending.length === 0 ? (
                        <div className="text-sm text-muted-foreground">Sem pendentes no filtro atual.</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Pessoa</TableHead>
                              <TableHead>Equipe</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredPending.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell className="min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="truncate">{p.name || p.id}</span>
                                    {p.is_leader && (
                                      <Badge variant="secondary" className="text-[10px]">
                                        Líder
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>{p.team_id ?? '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </ScrollArea>
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
                <CardTitle>Perguntas com menor acerto</CardTitle>
                <CardDescription>Use para identificar temas com menos acertos e planejar capacitação</CardDescription>
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
                    {worstQuestions.length === 0 ? (
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
                          {worstQuestions.map((q) => (
                            <TableRow key={q.id}>
                              <TableCell className="font-medium">{(q.order_index ?? 0) + 1}</TableCell>
                              <TableCell className="min-w-0">
                                <div className="line-clamp-3">{q.question_text}</div>
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
