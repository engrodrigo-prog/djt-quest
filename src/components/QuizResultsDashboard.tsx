import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';
import { getActiveLocale } from '@/lib/i18n/activeLocale';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

type Scope = 'team' | 'coord' | 'division' | 'all';

type StatRow = {
  eligibleUsers: number;
  participants: number;
  participationRate: number;
  avgScorePct: number | null;
  scoreSum?: number;
  maxSum?: number;
  division_id?: string | null;
  coord_id?: string | null;
  team_id?: string | null;
  base?: string | null;
};

type AttemptRow = {
  user_id: string;
  name: string;
  team_id: string | null;
  coord_id: string | null;
  division_id: string | null;
  operational_base: string | null;
  submitted_at: string | null;
  score: number;
  max_score: number;
  scorePct: number | null;
  is_leader?: boolean;
};

type QuizResultsPayload = {
  challengeId: string;
  scope: Scope;
  scopeId: string | null;
  includeLeaders: boolean;
  includeGuests: boolean;
  eligibleUsers: number;
  participants: number;
  participationRate: number;
  avgScorePct: number | null;
  divisions: StatRow[];
  coordinations: StatRow[];
  teams: StatRow[];
  bases: StatRow[];
  attempts: AttemptRow[];
};

const fmtPct = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v)}%` : '—');

export function QuizResultsDashboard({ challengeId }: { challengeId: string }) {
  const { orgScope, userRole, isLeader } = useAuth() as any;

  const role = String(userRole || '').trim();
  const canAll = role === 'admin' || role === 'gerente_djt' || role.includes('gerente') || role.includes('coordenador');

  const defaultScope: Scope = useMemo(() => {
    if (role === 'admin' || role === 'gerente_djt') return 'all';
    if (role === 'gerente_divisao_djtx') return 'division';
    if (role === 'coordenador_djtx') return 'coord';
    if (isLeader) return orgScope?.coordId ? 'coord' : 'team';
    return 'team';
  }, [isLeader, orgScope?.coordId, role]);

  const [scope, setScope] = useState<Scope>(defaultScope);
  const [scopeId, setScopeId] = useState<string>('');
  const [includeLeaders, setIncludeLeaders] = useState(true);
  const [includeGuests, setIncludeGuests] = useState(false);
  const [tab, setTab] = useState<'divisions' | 'coords' | 'teams' | 'bases' | 'people'>('coords');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<QuizResultsPayload | null>(null);

  useEffect(() => {
    const id =
      scope === 'team'
        ? orgScope?.teamId
        : scope === 'coord'
          ? orgScope?.coordId
          : scope === 'division'
            ? orgScope?.divisionId
            : '';
    if (scope !== 'all') setScopeId(id ? String(id) : '');
    else setScopeId('');
  }, [orgScope?.coordId, orgScope?.divisionId, orgScope?.teamId, scope]);

  useEffect(() => {
    // Tab defaults depending on scope
    if (scope === 'all') setTab('divisions');
    else if (scope === 'division') setTab('coords');
    else setTab('people');
  }, [scope]);

  const fetchResults = async () => {
    if (!challengeId) return;
    if (scope !== 'all' && !scopeId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('challengeId', challengeId);
      qs.set('scope', scope);
      if (scope !== 'all') qs.set('scopeId', scopeId);
      qs.set('includeLeaders', includeLeaders ? '1' : '0');
      qs.set('includeGuests', includeGuests ? '1' : '0');

      const resp = await apiFetch(`/api/admin?handler=reports-quiz-results&${qs.toString()}`, { cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar resultados');
      setData(json as QuizResultsPayload);
    } catch (e: any) {
      console.error('QuizResultsDashboard: fetchResults failed', e);
      toast.error(String(e?.message || 'Falha ao carregar resultados'));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId, includeGuests, includeLeaders, scope, scopeId]);

  const filteredAttempts = useMemo(() => {
    const rows = data?.attempts || [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = `${r.name || ''} ${r.team_id || ''} ${r.coord_id || ''} ${r.division_id || ''} ${r.operational_base || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data?.attempts, search]);

  const showDivisions = Boolean((data?.divisions || []).length);
  const showBases = Boolean((data?.bases || []).length);

  return (
    <Card className="bg-black/20 border-white/10">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Resultados do quiz</CardTitle>
            <CardDescription className="text-xs">
              Aderência (respondentes / elegíveis) e média de nota por organização
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={fetchResults} disabled={loading}>
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">Escopo</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Minha equipe</SelectItem>
                <SelectItem value="coord">Minha coordenação</SelectItem>
                <SelectItem value="division">Minha divisão</SelectItem>
                {canAll && <SelectItem value="all">Tudo</SelectItem>}
              </SelectContent>
            </Select>
            {scope !== 'all' && (
              <div className="text-[11px] text-muted-foreground truncate">
                ID: {scopeId || '—'}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Inclusões</Label>
            <div className="flex items-center justify-between gap-3 rounded border border-white/10 p-2 bg-black/20">
              <div className="min-w-0">
                <div className="text-xs font-medium">Líderes</div>
                <div className="text-[11px] text-muted-foreground">Contar líderes nos elegíveis e notas</div>
              </div>
              <Switch checked={includeLeaders} onCheckedChange={setIncludeLeaders} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded border border-white/10 p-2 bg-black/20">
              <div className="min-w-0">
                <div className="text-xs font-medium">Convidados</div>
                <div className="text-[11px] text-muted-foreground">Incluir equipe CONVIDADOS</div>
              </div>
              <Switch checked={includeGuests} onCheckedChange={setIncludeGuests} />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Resumo</Label>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Elegíveis: {data?.eligibleUsers ?? (loading ? '…' : 0)}</Badge>
              <Badge variant="outline">Respondentes: {data?.participants ?? (loading ? '…' : 0)}</Badge>
              <Badge variant="outline">Aderência: {data ? `${data.participationRate}%` : loading ? '…' : '0%'}</Badge>
              <Badge variant="outline">Média: {fmtPct(data?.avgScorePct)}</Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-5">
            <TabsTrigger value="divisions" disabled={!showDivisions}>
              Divisões
            </TabsTrigger>
            <TabsTrigger value="coords">Coordenações</TabsTrigger>
            <TabsTrigger value="teams">Equipes</TabsTrigger>
            <TabsTrigger value="bases" disabled={!showBases}>
              Bases
            </TabsTrigger>
            <TabsTrigger value="people">Pessoas</TabsTrigger>
          </TabsList>

          <TabsContent value="divisions" className="space-y-2">
            <ScrollArea className="h-[320px] w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Divisão</TableHead>
                    <TableHead className="text-right">Elegíveis</TableHead>
                    <TableHead className="text-right">Respondentes</TableHead>
                    <TableHead className="text-right">Aderência</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.divisions || []).map((r, idx) => (
                    <TableRow key={`${r.division_id || '—'}:${idx}`}>
                      <TableCell className="font-medium">{r.division_id || '—'}</TableCell>
                      <TableCell className="text-right">{r.eligibleUsers}</TableCell>
                      <TableCell className="text-right">{r.participants}</TableCell>
                      <TableCell className="text-right">{r.participationRate}%</TableCell>
                      <TableCell className="text-right">{fmtPct(r.avgScorePct)}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && (data?.divisions || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        Sem dados para este escopo.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="coords" className="space-y-2">
            <ScrollArea className="h-[320px] w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Coordenação</TableHead>
                    <TableHead>Divisão</TableHead>
                    <TableHead className="text-right">Elegíveis</TableHead>
                    <TableHead className="text-right">Respondentes</TableHead>
                    <TableHead className="text-right">Aderência</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.coordinations || []).map((r, idx) => (
                    <TableRow key={`${r.coord_id || '—'}:${idx}`}>
                      <TableCell className="font-medium">{r.coord_id || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.division_id || '—'}</TableCell>
                      <TableCell className="text-right">{r.eligibleUsers}</TableCell>
                      <TableCell className="text-right">{r.participants}</TableCell>
                      <TableCell className="text-right">{r.participationRate}%</TableCell>
                      <TableCell className="text-right">{fmtPct(r.avgScorePct)}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && (data?.coordinations || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">
                        Sem coordenações no escopo selecionado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="teams" className="space-y-2">
            <ScrollArea className="h-[320px] w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipe</TableHead>
                    <TableHead>Coordenação</TableHead>
                    <TableHead>Divisão</TableHead>
                    <TableHead className="text-right">Elegíveis</TableHead>
                    <TableHead className="text-right">Respondentes</TableHead>
                    <TableHead className="text-right">Aderência</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.teams || []).map((r, idx) => (
                    <TableRow key={`${r.team_id || '—'}:${idx}`}>
                      <TableCell className="font-medium">{r.team_id || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.coord_id || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.division_id || '—'}</TableCell>
                      <TableCell className="text-right">{r.eligibleUsers}</TableCell>
                      <TableCell className="text-right">{r.participants}</TableCell>
                      <TableCell className="text-right">{r.participationRate}%</TableCell>
                      <TableCell className="text-right">{fmtPct(r.avgScorePct)}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && (data?.teams || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-sm text-muted-foreground">
                        Sem equipes no escopo selecionado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="bases" className="space-y-2">
            <ScrollArea className="h-[320px] w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Base</TableHead>
                    <TableHead>Coordenação</TableHead>
                    <TableHead>Divisão</TableHead>
                    <TableHead className="text-right">Elegíveis</TableHead>
                    <TableHead className="text-right">Respondentes</TableHead>
                    <TableHead className="text-right">Aderência</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.bases || []).map((r, idx) => (
                    <TableRow key={`${r.coord_id || '—'}:${r.base || '—'}:${idx}`}>
                      <TableCell className="font-medium">{r.base || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.coord_id || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.division_id || '—'}</TableCell>
                      <TableCell className="text-right">{r.eligibleUsers}</TableCell>
                      <TableCell className="text-right">{r.participants}</TableCell>
                      <TableCell className="text-right">{r.participationRate}%</TableCell>
                      <TableCell className="text-right">{fmtPct(r.avgScorePct)}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && (data?.bases || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-sm text-muted-foreground">
                        Sem bases registradas no escopo selecionado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="people" className="space-y-2">
            <Input
              placeholder="Buscar por nome, equipe, coordenação ou base…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ScrollArea className="h-[360px] pr-3">
              <div className="space-y-2">
                {loading && <div className="text-sm text-muted-foreground">Carregando…</div>}
                {!loading && filteredAttempts.length === 0 && (
                  <div className="text-sm text-muted-foreground">Sem notas registradas para este quiz.</div>
                )}
                {filteredAttempts.map((row) => {
                  const pct = typeof row.scorePct === 'number' ? Math.round(row.scorePct) : null;
                  const when = row.submitted_at ? new Date(row.submitted_at).toLocaleString(getActiveLocale()) : '';
                  return (
                    <div key={row.user_id} className="flex items-center justify-between gap-3 p-2 rounded border border-white/10 bg-black/10">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{row.name || '—'}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {(row.team_id || row.coord_id || row.division_id) ? (
                            <>
                              {row.team_id ? `Equipe: ${row.team_id}` : row.coord_id ? `Coord: ${row.coord_id}` : `Div: ${row.division_id}`}
                              {row.operational_base ? ` • Base: ${row.operational_base}` : ''}
                            </>
                          ) : (
                            'Sem equipe'
                          )}
                          {when ? ` • ${when}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline">{row.score}/{row.max_score || 0}</Badge>
                        <Badge
                          variant={
                            pct == null ? 'secondary' : pct >= 70 ? 'default' : pct >= 40 ? 'secondary' : 'destructive'
                          }
                        >
                          {pct == null ? '—' : `${pct}%`}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

