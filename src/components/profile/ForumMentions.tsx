import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useNavigate } from 'react-router-dom'

interface MentionRow {
  id: string
  created_at: string
  is_read: boolean
  post_id: string
  post?: {
    id: string
    topic_id: string
    topic?: { title?: string | null }
  }
}

export function ForumMentions() {
  const [rows, setRows] = useState<MentionRow[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data: session } = await supabase.auth.getSession()
        const userId = session.session?.user?.id
        if (!userId) { setRows([]); return }
        // Try with embed; fallback to basic if table or relation missing
        const { data, error } = await supabase
          .from('forum_mentions')
          .select(`
            id, created_at, is_read, post_id,
            post:forum_posts!forum_mentions_post_id_fkey (
              id, topic_id,
              topic:forum_topics!forum_posts_topic_id_fkey ( title )
            )
          `)
          .eq('mentioned_user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10)
        if (error) {
          const { data: basic } = await supabase
            .from('forum_mentions')
            .select('id, created_at, is_read, post_id')
            .eq('mentioned_user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10)
          if (mounted) setRows((basic || []) as any)
        } else if (mounted) {
          setRows((data || []) as any)
        }
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Menções no Fórum</CardTitle>
        <CardDescription>Últimas interações onde você foi mencionado</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground">Carregando...</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma menção recente</p>
        ) : (
          <div className="space-y-3">
            {rows.map((m) => {
              const title = m.post?.topic?.title || `Tópico ${m.post?.topic_id || ''}`
              return (
                <button
                  key={m.id}
                  type="button"
                  className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-accent/10 text-left"
                  onClick={() => {
                    const topicId = (m.post as any)?.topic_id
                    if (topicId) {
                      navigate(`/forum/${topicId}`)
                      // Considerar a menção como reconhecida ao navegar para o tópico
                      window.dispatchEvent(new CustomEvent('forum-mentions-seen'))
                    }
                  }}
                >
                  <div className="truncate pr-2">
                    <p className="text-sm font-medium truncate">{title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</p>
                  </div>
                  <Badge variant={m.is_read ? 'outline' : 'default'}>{m.is_read ? 'Lido' : 'Novo'}</Badge>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
