import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ThemedBackground } from '@/components/ThemedBackground'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import { HelpInfo } from '@/components/HelpInfo'
import { useI18n } from '@/contexts/I18nContext'

interface InsightItem {
  topic_id: string
  title: string
  priority: number
  chas: 'C'|'H'|'A'|'S'
  specialties: string[]
  summary: string
  proposed_actions: Array<{ type: string; title: string; description: string; target: string }>
  justification: string
}

export default function ForumInsights() {
  const { isLeader } = useAuth()
  const { toast } = useToast()
  const { t: tr } = useI18n()
  const loc = useLocation()
  const [items, setItems] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const search = new URLSearchParams(loc.search)
    const topicId = search.get('topic_id') || ''
    ;(async () => {
      try {
        const url = topicId
          ? `/api/forum?handler=top-insights&topic_id=${encodeURIComponent(topicId)}`
          : '/api/forum?handler=top-insights'
        const resp = await fetch(url)
        const j = await resp.json()
        if (!resp.ok) throw new Error(j?.error || tr("forumInsights.fetchErrorDesc"))
        setItems(j.items || [])
      } catch (e: any) {
        toast({ title: tr("forumInsights.fetchErrorTitle"), description: e?.message || tr("forumInsights.fetchErrorDesc"), variant: 'destructive' })
      } finally { setLoading(false) }
    })()
  }, [loc.search, toast, tr])

  const sendToStudio = (ins: InsightItem, kind: 'quiz' | 'desafio' | 'campanha') => {
    // Store a draft locally for Studio to pick up later
    const draft = { kind, title: ins.title, summary: ins.summary, actions: ins.proposed_actions, chas: ins.chas, specialties: ins.specialties }
    localStorage.setItem('studio_compendium_draft', JSON.stringify(draft))
    window.location.href = '/studio'
  }

  const chasLabel = (c: string) =>
    ({ C: tr("home.badgeKnowledge"), H: tr("home.badgeSkill"), A: tr("home.badgeAttitude"), S: tr("home.badgeSafety") } as any)[c] || c

  return (
    <div className="relative min-h-screen pb-40">
      <ThemedBackground theme="atitude" />
      <HelpInfo kind="forum" />
      <div className="container relative mx-auto p-4 md:p-6 max-w-5xl space-y-4">
        <div>
          <h1 className="text-3xl font-bold">{tr("forumInsights.title")}</h1>
          <p className="text-muted-foreground">
            {tr("forumInsights.subtitle")}
          </p>
        </div>
        {loading ? (
          <Card><CardContent className="p-6">{tr("common.loading")}</CardContent></Card>
        ) : items.length === 0 ? (
          <Card><CardContent className="p-6">{tr("forumInsights.empty")}</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {items.map((ins, idx) => (
              <Card key={ins.topic_id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">#{idx+1} — {ins.title}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">{ins.summary}</CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <Badge>{chasLabel(ins.chas)}</Badge>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {ins.specialties?.slice(0,4).map(s => (<Badge key={s} variant="outline" className="text-xs">{s}</Badge>))}
                      </div>
                      <Badge variant={ins.priority >=4 ? 'destructive' : ins.priority>=3 ? 'default' : 'secondary'}>
                        {tr("forumInsights.priorityLabel", { priority: ins.priority })}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm">
                    <div className="font-semibold mb-1">{tr("forumInsights.actionProposalsTitle")}</div>
                    <ul className="list-disc pl-6 space-y-1">
                      {ins.proposed_actions?.map((a, i) => (
                        <li key={i}>
                          <span className="font-medium capitalize">{a.type}</span>: {a.title} — {a.description}{" "}
                          <span className="text-xs text-muted-foreground">{tr("forumInsights.targetHint", { target: a.target })}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {isLeader && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={()=>sendToStudio(ins, 'quiz')}>{tr("forumInsights.createQuizDraft")}</Button>
                      <Button size="sm" variant="outline" onClick={()=>sendToStudio(ins, 'desafio')}>{tr("forumInsights.createChallengeDraft")}</Button>
                      <Button size="sm" variant="outline" onClick={()=>sendToStudio(ins, 'campanha')}>{tr("forumInsights.createCampaignDraft")}</Button>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">{ins.justification}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
