import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ThemedBackground } from '@/components/ThemedBackground'
import { HelpInfo } from '@/components/HelpInfo'
import { Flame, Share2 } from 'lucide-react'
import { buildAbsoluteAppUrl, openWhatsAppShare } from '@/lib/whatsappShare'
import { useI18n } from '@/contexts/I18nContext'
import { translateTextsCached } from '@/lib/i18n/aiTranslate'
import { ForumMentionsInbox } from '@/components/ForumMentionsInbox'
import Navigation from '@/components/Navigation'

interface Topic {
  id: string;
  title: string;
  description: string | null;
  status: string;
  chas_dimension: 'C'|'H'|'A'|'S';
  quiz_specialties: string[] | null;
  tags: string[] | null;
  created_at: string;
  title_translations?: Record<string, string> | null;
  description_translations?: Record<string, string> | null;
}

interface InsightItem {
  topic_id: string
  title: string
  priority: number
  chas: 'C'|'H'|'A'|'S'
  specialties: string[]
  summary: string
}

export default function Forums() {
  const { isLeader, studioAccess } = useAuth()
  const { locale, t: tr } = useI18n()
  const nav = useNavigate()
  const [topics, setTopics] = useState<Topic[]>([])
  const [q, setQ] = useState('')
  const [showTrending, setShowTrending] = useState(false)
  const [trendingLoading, setTrendingLoading] = useState(false)
  const [trendingRange, setTrendingRange] = useState<'week'|'month'|'quarter'|'semester'|'year'>('week')
  const [trendingItems, setTrendingItems] = useState<InsightItem[]>([])
  const [translatedTopicTitles, setTranslatedTopicTitles] = useState<Record<string, string>>({})
  const [translatedTopicDescriptions, setTranslatedTopicDescriptions] = useState<Record<string, string>>({})
  const [translatedTrendingTitles, setTranslatedTrendingTitles] = useState<Record<string, string>>({})
  const [translatedTrendingSummaries, setTranslatedTrendingSummaries] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('forum_topics').select('*').order('created_at', { ascending: false }).limit(200)
    setTopics((data || []) as any)
  }, [])

  useEffect(() => { load() }, [load])

  // Translate dynamic forum content (stored in PT-BR) for non-pt locales.
  useEffect(() => {
    if (!topics.length) return
    if (locale === 'pt-BR') {
      setTranslatedTopicTitles({})
      setTranslatedTopicDescriptions({})
      return
    }

    let cancelled = false
    ;(async () => {
      const subset = topics.slice(0, 60)
      const presetTitles: Record<string, string> = {}
      const presetDescs: Record<string, string> = {}
      topics.forEach((t) => {
        const existingTitle = (t as any)?.title_translations?.[locale]
        const existingDesc = (t as any)?.description_translations?.[locale]
        if (existingTitle) presetTitles[t.id] = existingTitle
        if (existingDesc) presetDescs[t.id] = existingDesc
      })

      const missingTitles: Topic[] = subset.filter((t) => !presetTitles[t.id])
      const missingDescs: Topic[] = subset.filter((t) => !presetDescs[t.id] && (t.description || '').trim())

      try {
        const [titleTr, descTr] = await Promise.all([
          missingTitles.length
            ? translateTextsCached({ targetLocale: locale as any, texts: missingTitles.map((t) => t.title || '') })
            : Promise.resolve([]),
          missingDescs.length
            ? translateTextsCached({
                targetLocale: locale as any,
                texts: missingDescs.map((t) => t.description || ''),
              })
            : Promise.resolve([]),
        ])

        if (cancelled) return
        setTranslatedTopicTitles({
          ...presetTitles,
          ...Object.fromEntries(missingTitles.map((t, i) => [t.id, (titleTr as any)[i] || t.title])),
        })
        setTranslatedTopicDescriptions({
          ...presetDescs,
          ...Object.fromEntries(
            missingDescs.map((t, i) => [t.id, (descTr as any)[i] || (t.description || '')]),
          ),
        })
      } catch {
        if (!cancelled) {
          setTranslatedTopicTitles(presetTitles)
          setTranslatedTopicDescriptions(presetDescs)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [locale, topics])

  // Não marcar menções como lidas automaticamente ao entrar em /forums.

  const fetchTrending = useCallback(async (range: typeof trendingRange) => {
    setTrendingLoading(true)
    try {
      const resp = await fetch(`/api/forum?handler=top-insights&range=${encodeURIComponent(range)}`)
      const j = await resp.json()
      if (!resp.ok) throw new Error(j?.error || 'Falha ao carregar trending topics')
      setTrendingItems((j.items || []).slice(0, 10))
    } catch (e: any) {
      console.error('Erro carregando trending topics do fórum:', e)
    } finally {
      setTrendingLoading(false)
    }
  }, [])

  const filtered = topics.filter(t => {
    if (!q) return true
    const needle = q.toLowerCase()
    const title = (translatedTopicTitles[t.id] || t.title || '').toLowerCase()
    return title.includes(needle) || (t.tags||[]).some(tag => String(tag || '').includes(needle))
  })

  // Translate the trending card content after it loads (best-effort).
  useEffect(() => {
    if (locale === 'pt-BR') return
    if (!trendingItems.length) return
    let cancelled = false
    ;(async () => {
      try {
        const titles = trendingItems.map((x) => x.title || '')
        const summaries = trendingItems.map((x) => x.summary || '')
        const [titleTr, sumTr] = await Promise.all([
          translateTextsCached({ targetLocale: locale as any, texts: titles }),
          translateTextsCached({ targetLocale: locale as any, texts: summaries }),
        ])
        if (cancelled) return
        setTranslatedTrendingTitles(Object.fromEntries(trendingItems.map((x, i) => [x.topic_id, titleTr[i] || x.title])))
        setTranslatedTrendingSummaries(Object.fromEntries(trendingItems.map((x, i) => [x.topic_id, sumTr[i] || x.summary])))
      } catch {
        // silent fallback
      }
    })()
    return () => { cancelled = true }
  }, [locale, trendingItems])

  return (
    <div className="relative min-h-screen pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:pb-10 lg:pl-[var(--djt-nav-desktop-offset)]">
      <ThemedBackground theme="atitude" />
      <HelpInfo kind="forum" />
      <div className="container relative mx-auto px-3 py-4 sm:px-4 md:px-5 md:py-6 lg:px-6 max-w-5xl space-y-4">
        <ForumMentionsInbox />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => nav('/dashboard')}
              className="-ml-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {tr("forums.backToDashboard")}
            </Button>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">{tr("forums.title")}</h1>
              <p className="text-sm text-muted-foreground sm:text-base">{tr("forums.subtitle")}</p>
            </div>
          </div>
          {(isLeader && studioAccess) && (
            <Button onClick={() => nav('/studio')}>{tr("forums.createTopic")}</Button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder={tr("forums.searchPlaceholder")}
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            className="w-full"
          />
          <Button variant="outline" onClick={()=>nav('/forums/insights')} className="w-full sm:w-auto">
            {tr("forums.topThemesButton")}
          </Button>
        </div>
        <Card className="border-amber-600/40 bg-amber-950/20">
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-400" />
                <CardTitle className="text-sm">{tr("forums.trendingTitle")}</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex text-[11px] rounded-full border border-amber-500/40 overflow-hidden">
                  {(['week','month','quarter'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { setTrendingRange(r); fetchTrending(r); setShowTrending(true); }}
                      className={`px-2 py-0.5 ${trendingRange === r ? 'bg-amber-500/20 text-amber-100' : 'text-amber-200/70'}`}
                    >
                      {r === 'week' ? tr("forums.trendingRange.week") : r === 'month' ? tr("forums.trendingRange.month") : tr("forums.trendingRange.quarter")}
                    </button>
                  ))}
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    const next = !showTrending
                    setShowTrending(next)
                    if (next && trendingItems.length === 0) fetchTrending(trendingRange)
                  }}
                >
                  {showTrending ? tr("forums.hide") : tr("forums.show")}
                </Button>
              </div>
            </div>
            <CardDescription className="text-[11px] mt-1">
              {tr("forums.trendingDescription")}
            </CardDescription>
          </CardHeader>
          {showTrending && (
            <CardContent className="pt-1 space-y-2">
              {trendingLoading ? (
                <p className="text-xs text-muted-foreground">{tr("forums.trendingLoading")}</p>
              ) : trendingItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tr("forums.trendingEmpty")}</p>
              ) : (
                <div className="space-y-1">
                  {trendingItems.map((ins, idx) => (
                    <div
                      key={ins.topic_id}
                      role="button"
                      tabIndex={0}
                      className="w-full text-left text-xs rounded-md border border-amber-500/30 bg-black/20 px-2 py-1 hover:bg-amber-500/10 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
                      onClick={() => nav(`/forum/${ins.topic_id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          nav(`/forum/${ins.topic_id}`)
                        }
                      }}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="font-semibold mr-1">#{idx+1}</span>
                        <span className="font-medium">{translatedTrendingTitles[ins.topic_id] || ins.title}</span>
                        <span className="block text-[11px] text-amber-100/80 line-clamp-2 mt-0.5">
                          {translatedTrendingSummaries[ins.topic_id] || ins.summary}
                        </span>
                      </span>
                      <div className="flex-shrink-0 flex flex-wrap items-center gap-1 sm:justify-end">
                        <Badge variant="outline">
                          {ins.chas === 'C'
                            ? tr("home.badgeKnowledge")
                            : ins.chas === 'H'
                            ? tr("home.badgeSkill")
                            : ins.chas === 'A'
                            ? tr("home.badgeAttitude")
                            : tr("home.badgeSafety")}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-amber-100/90 hover:text-amber-50"
                          onClick={(e) => {
                            e.stopPropagation()
                            const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(ins.topic_id)}`)
                            openWhatsAppShare({
                              message: tr("dashboard.forumShareMessage", { title: ins.title }),
                              url,
                            })
                          }}
                          title={tr("dashboard.forumShareAria")}
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(t => (
            <Card key={t.id} className="cursor-pointer hover:-translate-y-1 transition" onClick={()=>nav(`/forum/${t.id}`)}>
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-base leading-snug line-clamp-2 sm:line-clamp-1 sm:text-lg">
                    {translatedTopicTitles[t.id] || t.title}
                  </CardTitle>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge variant={t.status === 'closed' ? 'secondary' : 'default'}>
                      {t.status === 'closed'
                        ? tr("forums.status.closed")
                        : t.status === 'open'
                        ? tr("forums.status.open")
                        : t.status}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(t.id)}`)
                        openWhatsAppShare({
                          message: tr("dashboard.forumShareMessage", { title: t.title }),
                          url,
                        })
                      }}
                      title={tr("dashboard.forumShareAria")}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardDescription className="line-clamp-2">{(translatedTopicDescriptions[t.id] || t.description || '').trim()}</CardDescription>
                <div className="flex flex-wrap gap-2 mt-2">
                  {t.quiz_specialties?.map(s => (<Badge key={s} variant="outline">{s}</Badge>))}
                  {t.tags?.slice(0,4).map(tag => (<Badge key={tag} className="bg-primary/10">#{tag}</Badge>))}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
      <Navigation />
    </div>
  )
}
