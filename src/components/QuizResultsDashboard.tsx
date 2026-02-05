import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';

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
  sigla_area?: string | null;
  operational_base: string | null;
  submitted_at: string | null;
  score: number;
  max_score: number;
  scorePct: number | null;
  is_leader?: boolean;
};

type PeopleRow = {
  user_id: string;
  name: string;
  team_id: string | null;
  coord_id: string | null;
  division_id: string | null;
  sigla_area?: string | null;
  operational_base: string | null;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
  scorePct: number | null;
  hasAttempt: boolean;
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
  people: PeopleRow[];
  attempts: AttemptRow[];
};

const fmtPct = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v)}%` : '—');
const round1 = (n: number) => Math.round(n * 10) / 10;

const GUEST_TEAM_ID = 'CONVIDADOS';
const EXTERNAL_TEAM_ID = 'EXTERNO';

const canonicalizeOrgId = (raw: unknown) => {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return s;
  if (s === 'DJT-PLA') return 'DJT-PLAN';
  if (s === 'DJTV-VOR') return 'DJTV-VOT';
  if (s === 'DJTB-STO') return 'DJTB-SAN';
  if (s === 'DJTV-ITP') return 'DJTV-ITA';
  return s;
};

const normalizeOrgId = (raw: unknown) => {
  const s = canonicalizeOrgId(raw);
  return s ? s : null;
};

const isGuestValue = (raw: unknown) => {
  const s = String(raw || '').trim().toUpperCase();
  return s === GUEST_TEAM_ID || s === EXTERNAL_TEAM_ID;
};

const isGuestProfile = (p: Partial<PeopleRow>) =>
  isGuestValue(p?.team_id) || isGuestValue((p as any)?.sigla_area) || isGuestValue(p?.operational_base);

const deriveDivisionFromId = (raw: unknown) => {
  const s = normalizeOrgId(raw);
  if (!s) return null;
  if (s === GUEST_TEAM_ID || s === EXTERNAL_TEAM_ID) return s;
  const base = s.split('-')[0];
  return base || s;
};

const deriveDivisionId = (p: Partial<PeopleRow>) => {
  const direct = normalizeOrgId(p?.division_id);
  if (direct && direct !== GUEST_TEAM_ID && direct !== EXTERNAL_TEAM_ID) return direct;
  return (
    deriveDivisionFromId(p?.coord_id) ||
    deriveDivisionFromId(p?.team_id) ||
    deriveDivisionFromId((p as any)?.sigla_area) ||
    null
  );
};

const DIV_ORDER = ['DJT', 'DJTV', 'DJTB'];
const divisionOrderIndex = (id: unknown) => {
  const i = DIV_ORDER.indexOf(String(id || '').toUpperCase());
  return i === -1 ? 999 : i;
};

type TreeKind = 'root' | 'division' | 'team' | 'person';

type TreeNode = {
  id: string;
  kind: TreeKind;
  label: string;
  eligibleUsers: number;
  participants: number;
  scoreSum: number;
  maxSum: number;
  participationRate: number;
  avgScorePct: number | null;
  children: TreeNode[];
  person?: PeopleRow;
};

type MutableTreeNode = Omit<TreeNode, 'children' | 'participationRate' | 'avgScorePct'> & {
  children: Map<string, MutableTreeNode>;
};

const createMutableNode = (id: string, kind: TreeKind, label: string): MutableTreeNode => ({
  id,
  kind,
  label,
  eligibleUsers: 0,
  participants: 0,
  scoreSum: 0,
  maxSum: 0,
  children: new Map(),
});

const addPersonStats = (node: MutableTreeNode, person: PeopleRow) => {
  node.eligibleUsers += 1;
  if (!person?.hasAttempt) return;
  node.participants += 1;
  const score = Number(person.score ?? 0) || 0;
  const max = Number(person.max_score ?? 0) || 0;
  node.scoreSum += score;
  node.maxSum += max;
};

const ensureChild = (parent: MutableTreeNode, key: string, kind: TreeKind, label: string) => {
  const existing = parent.children.get(key);
  if (existing) return existing;
  const child = createMutableNode(`${parent.id}/${key}`, kind, label);
  parent.children.set(key, child);
  return child;
};

const comparePersonNodes = (a: TreeNode, b: TreeNode) => {
  const ap = a.person;
  const bp = b.person;
  const aHas = ap?.hasAttempt ? 1 : 0;
  const bHas = bp?.hasAttempt ? 1 : 0;
  if (aHas !== bHas) return bHas - aHas;
  const aPct = typeof ap?.scorePct === 'number' ? ap.scorePct : -1;
  const bPct = typeof bp?.scorePct === 'number' ? bp.scorePct : -1;
  if (aPct !== bPct) return bPct - aPct;
  return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR');
};

const finalizeTree = (node: MutableTreeNode): TreeNode => {
  const eligible = Number(node.eligibleUsers || 0) || 0;
  const participants = Number(node.participants || 0) || 0;
  const scoreSum = Number(node.scoreSum || 0) || 0;
  const maxSum = Number(node.maxSum || 0) || 0;
  const participationRate = eligible > 0 ? round1((participants / eligible) * 100) : 0;
  const avgScorePct = maxSum > 0 ? round1((scoreSum / maxSum) * 100) : null;

  const children = Array.from(node.children.values()).map(finalizeTree);
  const isLeadersRoot = node.id === 'root:LEADERS';

  children.sort((a, b) => {
    // Keep groups above people at each level.
    if (a.kind !== b.kind) {
      if (a.kind === 'person') return 1;
      if (b.kind === 'person') return -1;
    }
    if (a.kind === 'division' && b.kind === 'division') {
      return divisionOrderIndex(a.label) - divisionOrderIndex(b.label) || String(a.label).localeCompare(String(b.label), 'pt-BR');
    }
    if (a.kind === 'person' && b.kind === 'person') {
      if (isLeadersRoot) return String(a.label).localeCompare(String(b.label), 'pt-BR', { sensitivity: 'base' });
      return comparePersonNodes(a, b);
    }
    return String(a.label).localeCompare(String(b.label), 'pt-BR');
  });

  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    eligibleUsers: eligible,
    participants,
    scoreSum,
    maxSum,
    participationRate,
    avgScorePct,
    children,
    person: node.person,
  };
};

const buildQuizOrgTree = (people: PeopleRow[]) => {
  const rootDjt = createMutableNode('root:DJT', 'root', 'DJT');
  const rootLeaders = createMutableNode('root:LEADERS', 'root', 'Líderes');
  const rootGuests = createMutableNode('root:GUESTS', 'root', 'Convidados');

  for (const p of people || []) {
    const guest = isGuestProfile(p);
    const leader = Boolean(p?.is_leader);
    const root = guest ? rootGuests : leader ? rootLeaders : rootDjt;
    addPersonStats(root, p);

    // Guests: show directly under the "Convidados" root (no extra CONVIDADOS->CONVIDADOS nesting).
    if (guest) {
      const personNode = ensureChild(root, `person:${p.user_id}`, 'person', p.name || '—');
      personNode.person = p;
      addPersonStats(personNode, p);
      continue;
    }

    // Leaders: list alphabetically at the collaborator level (no area/team drilldown).
    if (leader) {
      const personNode = ensureChild(root, `person:${p.user_id}`, 'person', p.name || '—');
      personNode.person = p;
      addPersonStats(personNode, p);
      continue;
    }

    const divisionId = deriveDivisionId(p) || '—';
    const divisionLabel = divisionId === '—' ? 'Sem divisão' : divisionId;
    const divNode = ensureChild(root, `division:${divisionId}`, 'division', divisionLabel);
    addPersonStats(divNode, p);

    const teamId = normalizeOrgId(p?.team_id) || '—';
    const shouldSkipTeam = teamId !== '—' && divisionId !== '—' && teamId === divisionId;
    const parent = shouldSkipTeam
      ? divNode
      : (() => {
          const teamLabel = teamId === '—' ? 'Sem equipe' : teamId;
          const teamNode = ensureChild(divNode, `team:${teamId}`, 'team', teamLabel);
          addPersonStats(teamNode, p);
          return teamNode;
        })();

    const personNode = ensureChild(parent, `person:${p.user_id}`, 'person', p.name || '—');
    personNode.person = p;
    addPersonStats(personNode, p);
  }

  const roots = [finalizeTree(rootDjt), finalizeTree(rootLeaders), finalizeTree(rootGuests)];
  return roots.filter((r) => r.eligibleUsers > 0);
};

type FlatRow = { node: TreeNode; depth: number };

const flattenTree = (nodes: TreeNode[], expanded: Record<string, true>, depth = 0): FlatRow[] => {
  const out: FlatRow[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children.length > 0 && expanded[n.id]) {
      out.push(...flattenTree(n.children, expanded, depth + 1));
    }
  }
  return out;
};

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
  const [includeGuests, setIncludeGuests] = useState(true);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<QuizResultsPayload | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, true>>({
    'root:DJT': true,
    'root:LEADERS': true,
    'root:GUESTS': true,
  });

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

  const treeRoots = useMemo(() => buildQuizOrgTree((data?.people || []) as PeopleRow[]), [data?.people]);

  const totals = useMemo(() => {
    return treeRoots.reduce(
      (acc, r) => {
        acc.eligible += Number(r.eligibleUsers || 0) || 0;
        acc.participants += Number(r.participants || 0) || 0;
        acc.scoreSum += Number(r.scoreSum || 0) || 0;
        acc.maxSum += Number(r.maxSum || 0) || 0;
        return acc;
      },
      { eligible: 0, participants: 0, scoreSum: 0, maxSum: 0 },
    );
  }, [treeRoots]);

  const totalParticipationRate = totals.eligible > 0 ? round1((totals.participants / totals.eligible) * 100) : 0;
  const totalAvgScorePct = totals.maxSum > 0 ? round1((totals.scoreSum / totals.maxSum) * 100) : null;

  const flatRows = useMemo(() => flattenTree(treeRoots, expandedNodes), [expandedNodes, treeRoots]);

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
                <div className="text-[11px] text-muted-foreground">Exibir em grupo separado</div>
              </div>
              <Switch checked={includeLeaders} onCheckedChange={setIncludeLeaders} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded border border-white/10 p-2 bg-black/20">
              <div className="min-w-0">
                <div className="text-xs font-medium">Convidados</div>
                <div className="text-[11px] text-muted-foreground">Exibir em grupo separado</div>
              </div>
              <Switch checked={includeGuests} onCheckedChange={setIncludeGuests} />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Resumo</Label>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Elegíveis: {loading ? '…' : totals.eligible}</Badge>
              <Badge variant="outline">Respondentes: {loading ? '…' : totals.participants}</Badge>
              <Badge variant="outline">Aderência: {loading ? '…' : `${totalParticipationRate}%`}</Badge>
              <Badge variant="outline">Média: {loading ? '…' : fmtPct(totalAvgScorePct)}</Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <ScrollArea className="h-[420px] w-full pr-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organização</TableHead>
                <TableHead className="text-right">Elegíveis</TableHead>
                <TableHead className="text-right">Respondentes</TableHead>
                <TableHead className="text-right">Aderência</TableHead>
                <TableHead className="text-right">Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flatRows.map(({ node, depth }) => {
                const hasChildren = node.children.length > 0;
                const expanded = Boolean(expandedNodes[node.id]);
                const indentPx = depth * 16;
                const isPerson = node.kind === 'person';
                const person = node.person;
                const pct = isPerson && person && typeof person.scorePct === 'number' ? Math.round(person.scorePct) : null;
                const score = isPerson && person && typeof person.score === 'number' ? person.score : null;
                const max = isPerson && person && typeof person.max_score === 'number' ? person.max_score : null;
                const pending = isPerson && person ? !person.hasAttempt : false;

                return (
                  <TableRow key={node.id}>
                    <TableCell className={node.kind === 'root' ? 'font-semibold' : 'font-medium'}>
                      <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: indentPx }}>
                        {hasChildren ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 flex-shrink-0"
                            aria-label={expanded ? `Recolher ${node.label}` : `Expandir ${node.label}`}
                            onClick={() =>
                              setExpandedNodes((prev) => {
                                const next = { ...prev };
                                if (next[node.id]) delete next[node.id];
                                else next[node.id] = true;
                                return next;
                              })
                            }
                          >
                            {expanded ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                          </Button>
                        ) : (
                          <div className="h-7 w-7 flex-shrink-0" />
                        )}
                        <div className="min-w-0 truncate">{node.label}</div>
                        {pending && (
                          <Badge variant="secondary" className="ml-auto text-[10px]">
                            Pendente
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{node.eligibleUsers}</TableCell>
                    <TableCell className="text-right">{node.participants}</TableCell>
                    <TableCell className="text-right">{node.participationRate}%</TableCell>
                    <TableCell className="text-right">
                      {isPerson ? (
                        pending ? (
                          '—'
                        ) : (
                          <div className="flex flex-col items-end leading-tight">
                            <div>{pct == null ? '—' : `${pct}%`}</div>
                            <div className="text-[11px] text-muted-foreground">{`${score ?? 0}/${max ?? 0}`}</div>
                          </div>
                        )
                      ) : (
                        fmtPct(node.avgScorePct)
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {!loading && flatRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    Sem dados para este escopo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
