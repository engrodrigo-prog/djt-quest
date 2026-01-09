import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { apiFetch } from '@/lib/api'
import { getActiveLocale } from '@/lib/i18n/activeLocale'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ExternalLink } from 'lucide-react'

type PendingStage = 'pending_first' | 'pending_second' | 'pending'

type LeaderStat = {
  leader_id: string
  leader_name: string | null
  pending: number
}

type PendingEvent = {
  event_id: string
  created_at: string
  status: string
  awaiting_second_evaluation: boolean
  retry_count: number
  stage: PendingStage
  challenge: { id: string; title: string; require_two_leader_eval: boolean } | null
  submitter: { id: string; name: string; matricula: string | null } | null
  evidence_urls: string[]
  first_evaluation_rating: number | null
  second_evaluation_rating: number | null
  first_evaluator: { id: string; name: string | null } | null
  second_evaluator: { id: string; name: string | null } | null
  assignments: Array<{
    id: string
    assigned_to: string | null
    assigned_name: string | null
    assigned_at: string | null
    is_cross_evaluation: boolean
    created_at: string
  }>
  evaluations: Array<{
    id: string
    reviewer_id: string
    reviewer_name: string | null
    evaluation_number: number | null
    rating: number | null
    final_rating: number | null
    created_at: string
  }>
}

type HistoryItem = {
  id: string
  event_id: string
  created_at: string
  evaluation_number: number | null
  rating: number | null
  final_rating: number | null
  reviewer: { id: string; name: string | null }
  submitter: { id: string; name: string; matricula: string | null } | null
  challenge: { id: string; title: string } | null
  event_status: string | null
}

const normalizeKey = (value: any) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const formatDate = (iso: string) => {
  const ts = Date.parse(String(iso || ''))
  if (!Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleString(getActiveLocale())
}

const statusBadge = (status: string) => {
  const s = String(status || '').toLowerCase()
  if (s.includes('approved')) return <Badge variant="default">Aprovado</Badge>
  if (s.includes('awaiting_second')) return <Badge variant="secondary">Aguardando 2ª</Badge>
  if (s.includes('retry')) return <Badge variant="destructive">Retry</Badge>
  if (s.includes('submitted')) return <Badge variant="outline">Submetido</Badge>
  return <Badge variant="outline">{status || '—'}</Badge>
}

const stageLabel = (stage: PendingStage) => {
  if (stage === 'pending_second') return '2ª avaliação'
  if (stage === 'pending_first') return '1ª avaliação'
  return 'pendente'
}

export default function EvaluationManagement() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const [q, setQ] = useState('')
  const [leaderId, setLeaderId] = useState<string>('all')
  const [tab, setTab] = useState<'pending' | 'history' | 'leaders'>('pending')
  const [pendingStage, setPendingStage] = useState<'all' | 'pending_first' | 'pending_second'>('all')

  const [pending, setPending] = useState<PendingEvent[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [leaders, setLeaders] = useState<LeaderStat[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Não autenticado')

      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (leaderId && leaderId !== 'all') params.set('leaderId', leaderId)

      const resp = await apiFetch(`/api/admin?handler=admin-evaluations-dashboard&${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar avaliações')

      const pendingRows = Array.isArray(json?.pending) ? (json.pending as PendingEvent[]) : []
      const historyRows = Array.isArray(json?.history) ? (json.history as HistoryItem[]) : []
      const leaderRows = Array.isArray(json?.leader_stats) ? (json.leader_stats as LeaderStat[]) : []

      setPending(pendingRows)
      setHistory(historyRows)
      setLeaders(leaderRows)
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao carregar avaliações')
    } finally {
      setLoading(false)
    }
  }, [leaderId, q])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const filteredPending = useMemo(() => {
    let rows = pending.slice()
    if (pendingStage !== 'all') rows = rows.filter((p) => p.stage === pendingStage)
    return rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  }, [pending, pendingStage])

  const filteredHistory = useMemo(() => {
    const nq = normalizeKey(q)
    let rows = history.slice()
    if (nq) {
      rows = rows.filter((h) =>
        normalizeKey([h?.reviewer?.name, h?.submitter?.name, h?.submitter?.matricula, h?.challenge?.title].filter(Boolean).join(' ')).includes(nq),
      )
    }
    return rows
  }, [history, q])

  const onSearch = async () => {
    setRefreshKey((x) => x + 1)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Avaliações (visão Admin)</h2>
        <p className="text-muted-foreground">Pendências e histórico de avaliações, com líderes atribuídos e notas aplicadas.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Busque por colaborador, matrícula, desafio, líder ou ID do evento.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-2 md:col-span-2">
            <Label>Busca</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Ex.: "ninhos", "Heles", matrícula, ou event_id' />
          </div>
          <div className="space-y-2">
            <Label>Líder</Label>
            <Select value={leaderId} onValueChange={setLeaderId}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {leaders.map((l) => (
                  <SelectItem key={l.leader_id} value={l.leader_id}>
                    {l.leader_name || l.leader_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setRefreshKey((x) => x + 1)} disabled={loading}>
              Atualizar
            </Button>
            <Button variant="game" onClick={onSearch} disabled={loading}>
              Buscar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Pendentes ({pending.length})</TabsTrigger>
          <TabsTrigger value="leaders">Carga por líder</TabsTrigger>
          <TabsTrigger value="history">Histórico ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="leaders">
          <Card>
            <CardHeader>
              <CardTitle>Pendências por líder</CardTitle>
              <CardDescription>Quantidade de avaliações em aberto por avaliador.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Carregando...</div>
              ) : leaders.length === 0 ? (
                <div className="text-sm text-muted-foreground">Sem dados.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Líder</TableHead>
                      <TableHead className="text-right">Pendentes</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaders.map((l) => (
                      <TableRow key={l.leader_id}>
                        <TableCell className="font-medium">{l.leader_name || l.leader_id}</TableCell>
                        <TableCell className="text-right">{l.pending}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setLeaderId(l.leader_id)
                              setTab('pending')
                              setRefreshKey((x) => x + 1)
                            }}
                          >
                            Ver pendências
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Pendências</CardTitle>
                  <CardDescription>Mostra onde cada evidência está parada e com quais líderes.</CardDescription>
                </div>
                <div className="space-y-2">
                  <Label>Etapa</Label>
                  <Select value={pendingStage} onValueChange={(v) => setPendingStage(v as any)}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="pending_first">1ª avaliação</SelectItem>
                      <SelectItem value="pending_second">2ª avaliação</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Carregando...</div>
              ) : filteredPending.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhuma pendência encontrada.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Desafio</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Etapa</TableHead>
                      <TableHead>Líderes atribuídos</TableHead>
                      <TableHead>Evidências</TableHead>
                      <TableHead>Enviado em</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPending.map((p) => (
                      <TableRow key={p.event_id}>
                        <TableCell className="font-medium">
                          {p.submitter?.name || '—'}
                          {p.submitter?.matricula ? <div className="text-xs text-muted-foreground">{p.submitter.matricula}</div> : null}
                        </TableCell>
                        <TableCell>{p.challenge?.title || '—'}</TableCell>
                        <TableCell>{statusBadge(p.status)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{stageLabel(p.stage)}</Badge>
                        </TableCell>
                        <TableCell>
                          {(p.assignments || []).length === 0 ? (
                            <Badge variant="outline">Sem líder</Badge>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {(p.assignments || []).slice(0, 4).map((a) => (
                                <Badge key={a.id} variant={a.is_cross_evaluation ? 'secondary' : 'outline'}>
                                  {a.assigned_name || '—'}
                                  {a.is_cross_evaluation ? ' • cross' : ''}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{(p.evidence_urls || []).length}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(p.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/evaluations?event=${encodeURIComponent(p.event_id)}`)}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Abrir
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
              <CardDescription>Últimas avaliações registradas (por líder) com as notas aplicadas.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Carregando...</div>
              ) : filteredHistory.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhuma avaliação encontrada.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Líder</TableHead>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Desafio</TableHead>
                      <TableHead>Nota</TableHead>
                      <TableHead>Etapa</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHistory.slice(0, 200).map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium">{h.reviewer?.name || h.reviewer?.id}</TableCell>
                        <TableCell>{h.submitter?.name || '—'}</TableCell>
                        <TableCell>{h.challenge?.title || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{h.rating != null ? `${h.rating}/10` : '—'}</Badge>
                        </TableCell>
                        <TableCell>{h.evaluation_number ? <Badge variant="secondary">{h.evaluation_number}ª</Badge> : '—'}</TableCell>
                        <TableCell>{h.event_status ? statusBadge(h.event_status) : '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(h.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => navigate(`/evaluations?event=${encodeURIComponent(h.event_id)}`)}>
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Ver
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
