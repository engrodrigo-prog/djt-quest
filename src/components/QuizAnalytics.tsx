import { useEffect, useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiFetch } from '@/lib/api'
import { getActiveLocale } from '@/lib/i18n/activeLocale'

export function QuizAnalytics({ challengeId }: { challengeId: string }) {
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [data, setData] = useState<{
    eligibleUsers: number
    participants: number
    participationRate: number
    attempts: Array<{
      user_id: string
      name: string
      team_id: string | null
      submitted_at: string | null
      score: number
      max_score: number
      scorePct: number | null
      is_leader?: boolean
    }>
  }>({ eligibleUsers: 0, participants: 0, participationRate: 0, attempts: [] })

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const resp = await apiFetch(`/api/admin?handler=reports-quiz-attempts&challengeId=${encodeURIComponent(challengeId)}`, {
          method: 'GET',
          cache: 'no-store',
        })
        const json = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar histórico')
        if (mounted) {
          setData({
            eligibleUsers: Number(json?.eligibleUsers ?? 0) || 0,
            participants: Number(json?.participants ?? 0) || 0,
            participationRate: Number(json?.participationRate ?? 0) || 0,
            attempts: Array.isArray(json?.attempts) ? json.attempts : [],
          })
        }
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [challengeId])

  if (loading) return <Card><CardContent className="p-4">Carregando...</CardContent></Card>

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return data.attempts || []
    return (data.attempts || []).filter((a) => {
      const name = String(a?.name || '').toLowerCase()
      const team = String(a?.team_id || '').toLowerCase()
      return name.includes(term) || team.includes(term)
    })
  }, [data.attempts, search])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aderência e notas</CardTitle>
        <CardDescription>Participantes e pontuação por pessoa</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">Elegíveis: {data.eligibleUsers}</Badge>
          <Badge variant="outline">Participantes: {data.participants}</Badge>
          <Badge variant="outline">Aderência: {data.participationRate}%</Badge>
        </div>
        <Input
          placeholder="Buscar por nome ou equipe…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ScrollArea className="h-[360px] pr-3">
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground">Sem notas registradas para este quiz.</div>
            ) : filtered.map((row) => {
              const pct = typeof row.scorePct === 'number' ? Math.round(row.scorePct) : null
              const when = row.submitted_at ? new Date(row.submitted_at).toLocaleString(getActiveLocale()) : ''
              return (
                <div key={row.user_id} className="flex items-center justify-between gap-3 p-2 rounded border">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{row.name || '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {row.team_id ? `Equipe: ${row.team_id}` : 'Sem equipe'}
                      {when ? ` • ${when}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline">{row.score}/{row.max_score || 0}</Badge>
                    <Badge variant={pct == null ? 'secondary' : pct >= 70 ? 'default' : pct >= 40 ? 'secondary' : 'destructive'}>
                      {pct == null ? '—' : `${pct}%`}
                    </Badge>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
