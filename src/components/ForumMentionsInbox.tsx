import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { apiFetch } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type MentionRow = {
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

export function ForumMentionsInbox() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)
  const [rows, setRows] = useState<MentionRow[]>([])

  const unreadCount = useMemo(() => rows.filter((r) => !r.is_read).length, [rows])

  const load = async () => {
    setLoading(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const userId = session.session?.user?.id
      if (!userId) {
        setRows([])
        return
      }
      const { data, error } = await supabase
        .from('forum_mentions')
        .select(
          `
          id, created_at, is_read, post_id,
          post:forum_posts!forum_mentions_post_id_fkey (
            id, topic_id,
            topic:forum_topics!forum_posts_topic_id_fkey ( title )
          )
        `,
        )
        .eq('mentioned_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(12)
      if (!error) setRows((data || []) as any)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const markOneRead = async (mentionId: string, postId: string) => {
    try {
      const { data: session } = await supabase.auth.getSession()
      const userId = session.session?.user?.id
      if (!userId) return
      await supabase.from('forum_mentions').update({ is_read: true } as any).eq('id', mentionId).eq('mentioned_user_id', userId)
      try {
        const now = new Date().toISOString()
        await supabase
          .from('notifications')
          .update({ read: true, read_at: now } as any)
          .eq('user_id', userId)
          .eq('type', 'forum_mention')
          .contains('metadata', { post_id: postId } as any)
          .eq('read', false)
      } catch {
        // ignore
      }
      window.dispatchEvent(new CustomEvent('djt-refresh-badges'))
      setRows((prev) => prev.map((r) => (r.id === mentionId ? { ...r, is_read: true } : r)))
    } catch {
      // ignore
    }
  }

  const markAllRead = async () => {
    setMarking(true)
    try {
      await apiFetch('/api/forum-mentions-mark-seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      window.dispatchEvent(new CustomEvent('djt-refresh-badges'))
      setRows((prev) => prev.map((r) => ({ ...r, is_read: true })))
    } finally {
      setMarking(false)
    }
  }

  return (
    <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-white">Inbox</CardTitle>
            <CardDescription className="text-white/80">Menções no fórum (@)</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Badge className="bg-destructive text-white">{unreadCount > 99 ? '99+' : unreadCount}</Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-white/30 text-white h-9"
              disabled={marking || unreadCount === 0}
              onClick={markAllRead}
            >
              Marcar como lido
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-white/70">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-white/70">Sem menções recentes</p>
        ) : (
          <div className="space-y-2">
            {rows.map((m) => {
              const topicId = (m.post as any)?.topic_id
              const title = m.post?.topic?.title || 'Tópico'
              const isUnread = !m.is_read
              return (
                <button
                  key={m.id}
                  type="button"
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border border-white/20 bg-black/20 hover:bg-white/10 text-left"
                  onClick={async () => {
                    if (isUnread) await markOneRead(m.id, m.post_id)
                    if (topicId) nav(`/forum/${topicId}#post-${m.post_id}`)
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{title}</p>
                    <p className="text-xs text-white/60">{new Date(m.created_at).toLocaleString()}</p>
                  </div>
                  <Badge variant={isUnread ? 'default' : 'outline'} className={isUnread ? 'bg-destructive text-white' : 'border-white/30 text-white'}>
                    {isUnread ? 'Novo' : 'Lido'}
                  </Badge>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
