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
import { apiFetch } from '@/lib/api'
import { buildAbsoluteAppUrl, openWhatsAppShare } from '@/lib/whatsappShare'

interface Topic { id: string; title: string; description: string | null; status: string; chas_dimension: 'C'|'H'|'A'|'S'; quiz_specialties: string[] | null; tags: string[] | null; created_at: string }

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
  const nav = useNavigate()
  const [topics, setTopics] = useState<Topic[]>([])
  const [q, setQ] = useState('')
  const [showTrending, setShowTrending] = useState(false)
  const [trendingLoading, setTrendingLoading] = useState(false)
  const [trendingRange, setTrendingRange] = useState<'week'|'month'|'quarter'|'semester'|'year'>('week')
  const [trendingItems, setTrendingItems] = useState<InsightItem[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('forum_topics').select('*').order('created_at', { ascending: false }).limit(200)
    setTopics((data || []) as any)
  }, [])

  useEffect(() => { load() }, [load])

  // Ao entrar na área de fóruns, marcar menções como lidas e limpar badge global
  useEffect(() => {
    (async () => {
      try {
        await apiFetch('/api/forum-mentions-mark-seen', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        window.dispatchEvent(new CustomEvent('forum-mentions-seen'));
      } catch {
        // silencioso – se falhar, apenas mantém badge até próxima tentativa
      }
    })();
  }, [])

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

  const filtered = topics.filter(t => !q || t.title.toLowerCase().includes(q.toLowerCase()) || (t.tags||[]).some(tag => tag.includes(q.toLowerCase())))

  return (
    <div className="relative min-h-screen pb-40">
      <ThemedBackground theme="atitude" />
      <HelpInfo kind="forum" />
      <div className="container relative mx-auto p-4 md:p-6 max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => nav('/dashboard')}
              className="-ml-2 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Voltar ao painel
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Fóruns de Conhecimento</h1>
              <p className="text-muted-foreground">Temas curados por líderes; contribua com ideias, dúvidas e casos.</p>
            </div>
          </div>
          {(isLeader && studioAccess) && (
            <Button onClick={() => nav('/studio')}>Criar Tema</Button>
          )}
        </div>
        <div className="flex gap-3 items-center">
          <Input placeholder="Buscar por título ou #tag" value={q} onChange={(e)=>setQ(e.target.value)} />
          <Button variant="outline" onClick={()=>nav('/forums/insights')}>Top Temas & Ações</Button>
        </div>
        <Card className="border-amber-600/40 bg-amber-950/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-400" />
                <CardTitle className="text-sm">Trending Topics (Fórum)</CardTitle>
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
                      {r === 'week' ? '7 dias' : r === 'month' ? '30 dias' : '90 dias'}
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
                  {showTrending ? 'Esconder' : 'Ver'}
                </Button>
              </div>
            </div>
            <CardDescription className="text-[11px] mt-1">
              Resumo dos temas mais vivos no fórum, considerando engajamento e qualidade das contribuições.
            </CardDescription>
          </CardHeader>
          {showTrending && (
            <CardContent className="pt-1 space-y-2">
              {trendingLoading ? (
                <p className="text-xs text-muted-foreground">Carregando trending topics...</p>
              ) : trendingItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ainda sem trending topics no período.</p>
              ) : (
                <div className="space-y-1">
                  {trendingItems.map((ins, idx) => (
                    <div
                      key={ins.topic_id}
                      role="button"
                      tabIndex={0}
                      className="w-full text-left text-xs rounded-md border border-amber-500/30 bg-black/20 px-2 py-1 hover:bg-amber-500/10 flex items-start justify-between gap-2"
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
                        <span className="font-medium">{ins.title}</span>
                        <span className="block text-[11px] text-amber-100/80 line-clamp-2 mt-0.5">
                          {ins.summary}
                        </span>
                      </span>
                      <div className="ml-2 flex-shrink-0 flex items-center gap-1">
                        <Badge variant="outline">
                          {ins.chas === 'C' ? 'Conhecimento' : ins.chas === 'H' ? 'Habilidade' : ins.chas === 'A' ? 'Atitude' : 'Segurança'}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-amber-100/90 hover:text-amber-50"
                          onClick={(e) => {
                            e.stopPropagation()
                            const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(ins.topic_id)}`)
                            openWhatsAppShare({
                              message: `Veja este fórum no DJT Quest:\n${ins.title}`,
                              url,
                            })
                          }}
                          title="Compartilhar este fórum no WhatsApp"
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
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">{t.title}</CardTitle>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge variant={t.status === 'closed' ? 'secondary' : 'default'}>{t.status}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(t.id)}`)
                        openWhatsAppShare({
                          message: `Veja este fórum no DJT Quest:\n${t.title}`,
                          url,
                        })
                      }}
                      title="Compartilhar este fórum no WhatsApp"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardDescription className="line-clamp-2">{t.description}</CardDescription>
                <div className="flex flex-wrap gap-2 mt-2">
                  {t.quiz_specialties?.map(s => (<Badge key={s} variant="outline">{s}</Badge>))}
                  {t.tags?.slice(0,4).map(tag => (<Badge key={tag} className="bg-primary/10">#{tag}</Badge>))}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
