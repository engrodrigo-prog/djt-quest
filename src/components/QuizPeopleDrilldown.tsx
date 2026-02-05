import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { getActiveLocale } from '@/lib/i18n/activeLocale';

type Scope = 'team' | 'coord' | 'division' | 'all';

export function QuizPeopleDrilldown(props: {
  challengeId: string;
  scope: Scope;
  scopeId: string;
  includeLeaders: boolean;
  includeGuests: boolean;
  from: string;
  to: string;
}) {
  const { challengeId, scope, scopeId, includeLeaders, includeGuests, from, to } = props;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [peopleFilter, setPeopleFilter] = useState<'all' | 'responded' | 'pending'>('all');

  useEffect(() => {
    let active = true;
    (async () => {
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
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        const resp = await apiFetch(`/api/admin?handler=reports-quiz-results&${qs.toString()}`, { cache: 'no-store' });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar pessoas');
        if (active) setData(json);
      } catch (e: any) {
        console.error('QuizPeopleDrilldown: fetch failed', e);
        if (active) setData({ error: String(e?.message || 'Falha') });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [challengeId, from, includeGuests, includeLeaders, scope, scopeId, to]);

  const people = useMemo(() => {
    const rows = Array.isArray(data?.people) ? data.people : [];
    const q = search.trim().toLowerCase();
    const byText = q
      ? rows.filter((r: any) => {
          const hay = `${r.name || ''} ${r.team_id || ''} ${r.operational_base || ''}`.toLowerCase();
          return hay.includes(q);
        })
      : rows;
    if (peopleFilter === 'responded') return byText.filter((r: any) => !!r.hasAttempt);
    if (peopleFilter === 'pending') return byText.filter((r: any) => !r.hasAttempt);
    return byText;
  }, [data?.people, peopleFilter, search]);

  if (loading && !data) {
    return (
      <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }
  if (data?.error) {
    return <div className="p-3 text-sm text-destructive">{String(data.error)}</div>;
  }

  const eligibleUsers = Number(data?.eligibleUsers ?? 0) || 0;
  const participants = Number(data?.participants ?? 0) || 0;
  const pending = Math.max(0, eligibleUsers - participants);
  const avgScorePct = typeof data?.avgScorePct === 'number' ? Math.round(data.avgScorePct) : null;
  const participationRate = typeof data?.participationRate === 'number' ? data.participationRate : null;

  return (
    <div className="p-3 space-y-3 rounded-md border bg-black/10">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">Elegíveis: {eligibleUsers}</Badge>
        <Badge variant="outline">Respondentes: {participants}</Badge>
        <Badge variant="outline">Pendentes: {pending}</Badge>
        <Badge variant="outline">Aderência: {participationRate == null ? '—' : `${participationRate}%`}</Badge>
        <Badge variant="outline">Média: {avgScorePct == null ? '—' : `${avgScorePct}%`}</Badge>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="flex-1">
          <Label className="text-xs">Buscar</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, equipe ou base…"
            className="h-9"
          />
        </div>
        <div className="w-full md:w-[220px]">
          <Label className="text-xs">Filtro</Label>
          <Select value={peopleFilter} onValueChange={(v) => setPeopleFilter(v as any)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="responded">Só respondidos</SelectItem>
              <SelectItem value="pending">Só pendentes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="h-[360px] pr-3">
        <div className="space-y-2">
          {people.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sem pessoas para este filtro.</div>
          ) : (
            people.map((row: any) => {
              const pct = typeof row.scorePct === 'number' ? Math.round(row.scorePct) : null;
              const when = row.submitted_at ? new Date(row.submitted_at).toLocaleString(getActiveLocale()) : '';
              const hasAttempt = Boolean(row.hasAttempt);
              return (
                <div
                  key={row.user_id}
                  className="flex items-center justify-between gap-3 p-2 rounded border border-white/10 bg-black/10"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="font-medium truncate">{row.name || row.user_id}</div>
                      {row.is_leader && (
                        <Badge variant="secondary" className="text-[10px]">
                          Líder
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {row.team_id ? `Equipe: ${row.team_id}` : 'Sem equipe'}
                      {row.operational_base ? ` • Base: ${row.operational_base}` : ''}
                      {when ? ` • ${when}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!hasAttempt ? (
                      <Badge variant="secondary">Pendente</Badge>
                    ) : (
                      <>
                        <Badge variant="outline">
                          {Number(row.score ?? 0)}/{Number(row.max_score ?? 0)}
                        </Badge>
                        <Badge
                          variant={
                            pct == null ? 'secondary' : pct >= 70 ? 'default' : pct >= 40 ? 'secondary' : 'destructive'
                          }
                        >
                          {pct == null ? '—' : `${pct}%`}
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
