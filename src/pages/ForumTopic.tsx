import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { ThemedBackground } from '@/components/ThemedBackground'
import { useAuth } from '@/contexts/AuthContext'
import { HelpInfo } from '@/components/HelpInfo'
import { AttachmentUploader } from '@/components/AttachmentUploader'
import { AttachmentViewer } from '@/components/AttachmentViewer'
import { UserProfilePopover } from '@/components/UserProfilePopover'
import { SendUserFeedbackDialog } from '@/components/SendUserFeedbackDialog'
import { VoiceRecorderButton } from '@/components/VoiceRecorderButton'
import Navigation from '@/components/Navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MoreVertical, Share2, Volume2, Wand2, Trash2, Pencil, Reply, Heart, MessageSquare, Plus } from 'lucide-react'
import { buildAbsoluteAppUrl, openWhatsAppShare } from '@/lib/whatsappShare'
import { useTts } from '@/lib/tts'
import { getActiveLocale } from '@/lib/i18n/activeLocale'
import { localeToOpenAiLanguageTag, localeToSpeechLanguage } from '@/lib/i18n/language'
import { useI18n } from '@/contexts/I18nContext'
import { translateTextsCached } from '@/lib/i18n/aiTranslate'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiFetch } from '@/lib/api'

interface Topic {
  id: string;
  title: string;
  description: string | null;
  status: string;
  chas_dimension: 'C'|'H'|'A'|'S';
  quiz_specialties: string[] | null;
  tags: string[] | null;
  title_translations?: Record<string, string> | null;
  description_translations?: Record<string, string> | null;
}
interface Post {
  id: string;
  user_id: string;
  author_id?: string;
  content_md: string;
  payload: any;
  created_at: string;
  ai_assessment: any;
  parent_post_id?: string | null;
  reply_to_user_id?: string | null;
  translations?: Record<string, string> | null;
  is_edited?: boolean;
  edited_at?: string | null;
  likes_count?: number;
  has_liked?: boolean;
  author?: {
    name: string | null;
    sigla_area: string | null;
    avatar_thumbnail_url?: string | null;
  } | null;
}

export default function ForumTopic() {
  const { topicId: id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { isLeader, studioAccess, user, userRole, roles } = useAuth() as any
  const { locale, t: tr } = useI18n()
  const { ttsEnabled, isSpeaking, speak } = useTts()
  const [topic, setTopic] = useState<Topic | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [compendium, setCompendium] = useState<any | null>(null)
  const [content, setContent] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([])
  const [attachmentsUploading, setAttachmentsUploading] = useState(false)
  const [composerPlusOpen, setComposerPlusOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [editingPostText, setEditingPostText] = useState<string>('')
  const [mentionQuery, setMentionQuery] = useState<string>('')
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([])
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [mentionDraft, setMentionDraft] = useState<{ start: number; end: number; query: string } | null>(null)
  const [cleaningPostId, setCleaningPostId] = useState<string | null>(null)
  const [likingPosts, setLikingPosts] = useState<Record<string, boolean>>({})
  const [replyToPostId, setReplyToPostId] = useState<string | null>(null)
  const [replyToExcerpt, setReplyToExcerpt] = useState<string>('')
  const [translatedTopic, setTranslatedTopic] = useState<{ title?: string; description?: string }>({})
  const [translatedPosts, setTranslatedPosts] = useState<Record<string, string>>({})
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null)
  const [postLocalTranslations, setPostLocalTranslations] = useState<Record<string, string>>({})
  const [isTranslating, setIsTranslating] = useState(false)
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false)
  const [feedbackTarget, setFeedbackTarget] = useState<{
    userId: string;
    name?: string | null;
    context?: { type: string; url?: string | null; label?: string | null } | null;
  } | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const mentionDraftRef = useRef<{ start: number; end: number; query: string } | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const didScrollToHashRef = useRef(false)
  const translatingRef = useRef(false)
  const mentionReadDoneRef = useRef<Set<string>>(new Set())
  const mentionReadInFlightRef = useRef<Set<string>>(new Set())
  const mentionBadgeRefreshTimerRef = useRef<number | null>(null)

  const [hashtagDialogOpen, setHashtagDialogOpen] = useState(false)
  const [hashtagDialogTags, setHashtagDialogTags] = useState<string[]>([])
  const [hashtagDialogVariant, setHashtagDialogVariant] = useState<'addHashtags' | 'addHashtagsEdited'>('addHashtags')
  const hashtagDialogResolveRef = useRef<((choice: 'withHash' | 'withoutHash' | 'ignore') => void) | null>(null)

  const requestHashtagChoice = useCallback(async (tags: string[], variant: 'addHashtags' | 'addHashtagsEdited' = 'addHashtags') => {
    return await new Promise<'withHash' | 'withoutHash' | 'ignore'>((resolve) => {
      hashtagDialogResolveRef.current = resolve
      setHashtagDialogTags(tags)
      setHashtagDialogVariant(variant)
      setHashtagDialogOpen(true)
    })
  }, [])

  const resolveHashtagChoice = useCallback((choice: 'withHash' | 'withoutHash' | 'ignore') => {
    setHashtagDialogOpen(false)
    const resolve = hashtagDialogResolveRef.current
    hashtagDialogResolveRef.current = null
    try {
      resolve?.(choice)
    } catch { /* noop */ }
  }, [])

  const formatHashtags = useCallback((tags: string[], withHash: boolean) => {
    const normalized = (tags || [])
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .map((t) => (withHash ? `#${t.replace(/^#+/, '')}` : t.replace(/^#+/, '')))
    return Array.from(new Set(normalized)).slice(0, 12)
  }, [])

  const formatName = (name: string | null | undefined) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
    if (parts.length <= 1) return parts.join(' ')
    return `${parts[0]} ${parts[parts.length - 1]}`
  }

  const initials = (name: string | null | undefined) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
    if (!parts.length) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  }

  const topicTitle = translatedTopic.title || topic?.title || ''
  const topicDescription = translatedTopic.description ?? topic?.description ?? ''
  const summaryText = translatedSummary || compendium?.summary_md || ''
  const statusLabel =
    topic?.status === 'closed'
      ? tr('forums.status.closed')
      : topic?.status === 'open'
        ? tr('forums.status.open')
        : topic?.status || ''

  const sharePostToWhatsApp = useCallback(
    (postId: string, postText: string) => {
      const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(id || '')}#post-${encodeURIComponent(postId)}`)
      const preview = (postText || '').trim().replace(/\s+/g, ' ').slice(0, 160)
      const previewText = `${preview}${preview.length >= 160 ? '…' : ''}`
      openWhatsAppShare({
        message: tr('forumTopic.post.shareMessage', { title: topicTitle, preview: previewText }),
        url,
      })
    },
    [id, openWhatsAppShare, topicTitle, tr],
  )

  const speakText = useCallback(
    async (text: string) => {
      const raw = String(text || '')
      const hashIndex = raw.search(/(^|\\s)#[\\w\\-]+/)
      const trimmed = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw
      const cleaned = trimmed
        .replace(/#[\\w\\-]+/g, '')
        .trim()
      if (!cleaned) return
      if (!ttsEnabled) {
        toast({ title: tr('forumTopic.toast.enableTtsTitle') })
        return
      }
      try {
        await speak(cleaned)
      } catch (e: any) {
        toast({
          title: tr('forumTopic.toast.ttsFailedTitle'),
          description: e?.message || tr('forumTopic.toast.tryAgain'),
          variant: 'destructive',
        })
      }
    },
    [speak, toast, tr, ttsEnabled],
  )

  const load = useCallback(async () => {
    if (!id) return
    const [topicRes, postsRes, compendiumRes] = await Promise.all([
      supabase.from('forum_topics').select('*').eq('id', id).maybeSingle(),
      supabase.from('forum_posts').select('*').eq('topic_id', id).order('created_at', { ascending: true }),
      supabase.from('forum_compendia').select('*').eq('topic_id', id).maybeSingle(),
    ])
    const t = topicRes.data as any
    const c = compendiumRes.data as any
    const postsData = ((postsRes.data as any[]) || []) as any[]

    const authorIds = Array.from(
      new Set(
        postsData
          .map((row) => (row?.user_id || row?.author_id ? String(row.user_id || row.author_id) : null))
          .filter(Boolean),
      ),
    ) as string[]
    const authorMap = new Map<string, any>()
    if (authorIds.length) {
      try {
        const { data: authors } = await supabase
          .from('profiles')
          .select('id,name,sigla_area,avatar_thumbnail_url')
          .in('id', authorIds)
          .limit(1000)
        for (const a of authors || []) {
          if (a?.id) authorMap.set(String(a.id), a)
        }
      } catch { /* noop */ }
    }
    let likedSet = new Set<string>()
    if (user?.id && postsData.length) {
      try {
        const { data: likedRows } = await supabase
          .from('forum_likes')
          .select('post_id')
          .eq('user_id', user.id)
          .in('post_id', postsData.map((row) => row.id))
        likedSet = new Set((likedRows || []).map((row) => String(row.post_id)))
      } catch {
        likedSet = new Set()
      }
    }
    const postsWithLikes = postsData.map((post) => {
      const authorId = post?.user_id || post?.author_id ? String(post.user_id || post.author_id) : null
      return {
        ...post,
        likes_count: Number(post?.likes_count || 0),
        has_liked: likedSet.has(String(post.id)),
        author: authorId ? (authorMap.get(authorId) || null) : null,
      }
    })

    setTopic(t as any)
    setPosts(postsWithLikes as any)
    setCompendium((c as any) || null)
  }, [id, user?.id])

  useEffect(() => { load() }, [load])

  // Mark unread @mentions as read when the mentioned post becomes visible.
  // This keeps badges consistent with the "read post => clear mention notification" rule.
  useEffect(() => {
    const uid = user?.id ? String(user.id) : ''
    if (!uid || !id) return
    if (!posts.length) return

    let cancelled = false
    let observer: IntersectionObserver | null = null

    const scheduleBadgeRefresh = () => {
      if (mentionBadgeRefreshTimerRef.current) window.clearTimeout(mentionBadgeRefreshTimerRef.current)
      mentionBadgeRefreshTimerRef.current = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('djt-refresh-badges'))
      }, 450)
    }

    const markPostMentionRead = async (postId: string) => {
      const pid = String(postId || '').trim()
      if (!pid) return
      if (mentionReadDoneRef.current.has(pid)) return
      if (mentionReadInFlightRef.current.has(pid)) return
      mentionReadInFlightRef.current.add(pid)
      try {
        await supabase
          .from('forum_mentions')
          .update({ is_read: true } as any)
          .eq('mentioned_user_id', uid)
          .eq('post_id', pid)
          .eq('is_read', false)
        try {
          const now = new Date().toISOString()
          await supabase
            .from('notifications')
            .update({ read: true, read_at: now } as any)
            .eq('user_id', uid)
            .eq('type', 'forum_mention')
            .contains('metadata', { post_id: pid } as any)
            .eq('read', false)
        } catch {
          // ignore (best-effort)
        }
        mentionReadDoneRef.current.add(pid)
        scheduleBadgeRefresh()
      } finally {
        mentionReadInFlightRef.current.delete(pid)
      }
    }

    const run = async () => {
      const postIds = posts.map((p) => String(p.id || '').trim()).filter(Boolean)
      if (!postIds.length) return

      const unreadMentionPostIds = new Set<string>()
      const chunkSize = 50
      for (let i = 0; i < postIds.length; i += chunkSize) {
        if (cancelled) return
        const chunk = postIds.slice(i, i + chunkSize)
        const { data, error } = await supabase
          .from('forum_mentions')
          .select('post_id')
          .eq('mentioned_user_id', uid)
          .eq('is_read', false)
          .in('post_id', chunk)
        if (!error) {
          ;(data || []).forEach((r: any) => r?.post_id && unreadMentionPostIds.add(String(r.post_id)))
        }
      }

      if (cancelled) return
      if (!unreadMentionPostIds.size) return

      if (typeof IntersectionObserver === 'undefined') {
        await Promise.all(Array.from(unreadMentionPostIds).map((pid) => markPostMentionRead(pid)))
        return
      }

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            const el = entry.target as HTMLElement
            const rawId = String(el?.id || '')
            const m = /^post-(.+)$/.exec(rawId)
            const pid = m?.[1] ? String(m[1]) : ''
            if (!pid) return
            if (!unreadMentionPostIds.has(pid)) return
            void markPostMentionRead(pid)
          })
        },
        { root: null, threshold: 0.35 },
      )

      unreadMentionPostIds.forEach((pid) => {
        const el = document.getElementById(`post-${pid}`)
        if (el) observer?.observe(el)
      })
    }

    void run()

    return () => {
      cancelled = true
      if (observer) observer.disconnect()
      observer = null
      if (mentionBadgeRefreshTimerRef.current) window.clearTimeout(mentionBadgeRefreshTimerRef.current)
      mentionBadgeRefreshTimerRef.current = null
    }
  }, [id, posts, user?.id])

  const togglePostLike = async (post: Post) => {
    if (!user) {
      toast({ title: 'Faça login para curtir posts.' })
      return
    }
    if (likingPosts[post.id]) return
    const nextLiked = !post.has_liked
    const optimisticCount = Math.max(0, (post.likes_count || 0) + (nextLiked ? 1 : -1))
    setLikingPosts((prev) => ({ ...prev, [post.id]: true }))
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, has_liked: nextLiked, likes_count: optimisticCount } : p)),
    )
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Não autenticado')
      const resp = await fetch('/api/forum?handler=like', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ post_id: post.id, action: nextLiked ? 'like' : 'unlike' }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(json?.error || 'Falha ao curtir')
      if (typeof json?.like_count === 'number') {
        setPosts((prev) =>
          prev.map((p) => (p.id === post.id ? { ...p, likes_count: json.like_count } : p)),
        )
      }
    } catch (e: any) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, has_liked: post.has_liked, likes_count: post.likes_count } : p,
        ),
      )
      toast({
        title: 'Erro ao curtir',
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    } finally {
      setLikingPosts((prev) => ({ ...prev, [post.id]: false }))
    }
  }

  useEffect(() => {
    if (!topic) return
    const title = (topic as any)?.title_translations?.[locale] || topic.title
    const desc = (topic as any)?.description_translations?.[locale] || topic.description || ''
    setTranslatedTopic({ title, description: desc })
  }, [locale, topic])

  useEffect(() => {
    if (!posts.length) {
      setTranslatedPosts({})
      return
    }
    const map: Record<string, string> = {}
    posts.forEach((p) => {
      const stored = (p as any)?.translations?.[locale]
      if (stored) map[p.id] = stored
    })
    setTranslatedPosts(map)
  }, [locale, posts])

  useEffect(() => {
    if (!compendium) {
      setTranslatedSummary(null)
      return
    }
    const stored = (compendium as any)?.summary_translations?.[locale]
    setTranslatedSummary(stored || compendium.summary_md || null)
  }, [compendium, locale])

  useEffect(() => {
    if (locale === 'pt-BR') {
      setPostLocalTranslations({})
      return
    }
    if (!topic) return

    const missingTitle = !(topic as any)?.title_translations?.[locale]
    const missingDesc =
      !(topic as any)?.description_translations?.[locale] && typeof topic.description === 'string' && topic.description.trim().length > 0
    const missingPosts = posts.filter((p) => !((p as any)?.translations?.[locale])).slice(0, 60)

    let cancelled = false
    ;(async () => {
      try {
        if (missingTitle) {
          const tr = await translateTextsCached({ targetLocale: locale as any, texts: [topic.title] })
          if (!cancelled) setTranslatedTopic((prev) => ({ ...prev, title: tr?.[0] || topic.title }))
        }
        if (missingDesc) {
          const tr = await translateTextsCached({
            targetLocale: locale as any,
            texts: [topic.description || ''],
          })
          if (!cancelled) setTranslatedTopic((prev) => ({ ...prev, description: tr?.[0] || topic.description || '' }))
        }
        if (missingPosts.length) {
          const trPosts = await translateTextsCached({
            targetLocale: locale as any,
            texts: missingPosts.map((p) => p.content_md || ''),
          })
          if (!cancelled) {
            setPostLocalTranslations((prev) => ({
              ...prev,
              ...Object.fromEntries(missingPosts.map((p, i) => [p.id, trPosts[i] || p.content_md])),
            }))
          }
        }
      } catch {
        // best-effort only
      }
    })()

    return () => {
      cancelled = true
    }
  }, [locale, posts, topic])

  useEffect(() => {
    if (!audioFile) {
      setAudioPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(audioFile)
    setAudioPreviewUrl(url)
    return () => {
      try { URL.revokeObjectURL(url) } catch { /* ignore */ }
    }
  }, [audioFile])

  useEffect(() => {
    if (!posts.length) return
    if (didScrollToHashRef.current) return
    try {
      const hash = (window.location.hash || '').trim()
      if (!hash.startsWith('#')) return
      const targetId = hash.slice(1)
      if (!targetId) return
      const el = document.getElementById(targetId)
      if (el) {
        didScrollToHashRef.current = true
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } catch {
      // ignore
    }
  }, [posts.length])

  useEffect(() => {
    let cancelled = false
    if (!mentionDraft) {
      setMentionSuggestions([])
      return
    }

    const q = mentionQuery.trim()
    if (!q) {
      const recent = readRecentMentions()
      if (!cancelled) {
        setMentionSuggestions(recent)
        setMentionActiveIndex(0)
      }
      return
    }

    const t = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/sepbook-mention-suggest?q=${encodeURIComponent(q)}`)
        const json = await resp.json()
        if (!resp.ok) throw new Error(json?.error || 'Falha ao sugerir menções')
        if (!cancelled) {
          setMentionSuggestions(json.items || [])
          setMentionActiveIndex(0)
        }
      } catch {
        if (!cancelled) setMentionSuggestions([])
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [mentionDraft, mentionQuery])

  useEffect(() => {
    if (!topic) return
    const targetLocales: Array<'en' | 'zh-CN'> = ['en', 'zh-CN']
    const cappedPosts = posts.slice(0, 200)
    const needsTopic =
      targetLocales.some((loc) => !((topic as any)?.title_translations?.[loc])) ||
      targetLocales.some((loc) => !((topic as any)?.description_translations?.[loc]) && (topic.description || '').trim())
    const needsPosts = cappedPosts.some((p) => targetLocales.some((loc) => !((p as any)?.translations?.[loc])))
    const needsSummary =
      Boolean(compendium?.summary_md) &&
      targetLocales.some((loc) => !((compendium as any)?.summary_translations?.[loc]))

    if (!(needsTopic || needsPosts || needsSummary)) return
    if (translatingRef.current) return
    translatingRef.current = true
    setIsTranslating(true)

    ;(async () => {
      try {
        const { data: session } = await supabase.auth.getSession()
        const token = session.session?.access_token
        if (!token) throw new Error('Not authenticated')
        const resp = await fetch('/api/forum?handler=translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ topic_id: id, locales: targetLocales }),
        })
        const json = await resp.json().catch(() => ({}))
        if (resp.ok) {
          if (json.topic) {
            setTopic((prev) =>
              prev
                ? ({
                    ...prev,
                    title_translations: json.topic.title_translations,
                    description_translations: json.topic.description_translations,
                  } as any)
                : prev,
            )
          }
          if (json.posts) {
            setPosts((prev) =>
              prev.map((p) => (json.posts[p.id] ? ({ ...p, translations: json.posts[p.id] } as any) : p)),
            )
          }
          if (json.compendium?.summary_translations) {
            setCompendium((prev) =>
              prev ? { ...prev, summary_translations: json.compendium.summary_translations } : prev,
            )
          }
        }
      } catch (e) {
        console.error('Erro ao traduzir conteúdo do fórum', e)
      } finally {
        translatingRef.current = false
        setIsTranslating(false)
      }
    })()
  }, [compendium, id, posts, topic])

  const handleTranscribe = async () => {
    if (!audioFile) return
    try {
      setTranscribing(true)
      if (audioFile.size > 12 * 1024 * 1024) {
        throw new Error(tr('forumTopic.audio.tooLarge', { maxMB: 12 }))
      }
      const toBase64 = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(f) })
      const b64 = await toBase64(audioFile)
      const resp = await apiFetch('/api/ai?handler=transcribe-audio', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ audioBase64: b64, mode:'organize', language: localeToSpeechLanguage(getActiveLocale()) }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || tr('forumTopic.errors.transcribeFailed'))
      setContent(prev => [prev, j.text || j.transcript].filter(Boolean).join('\n\n'))
      toast({ title: tr('forumTopic.toast.audioInsertedTitle') })
    } catch (e: any) {
      toast({
        title: tr('forumTopic.toast.transcribeErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    } finally { setTranscribing(false) }
  }

  const handleCleanupContent = async () => {
    const text = (content || '').trim()
    if (text.length < 3) {
      toast({
        title: tr('forumTopic.toast.nothingToReviewTitle'),
        description: tr('forumTopic.toast.nothingToReviewDesc'),
        variant: 'default',
      })
      return
    }
    try {
      setCleaning(true)
      const resp = await apiFetch('/api/ai?handler=cleanup-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: topic?.title || '', description: text, language: localeToOpenAiLanguageTag(getActiveLocale()) })
      })
      const j = await resp.json().catch(() => ({}))
      const usedAI = j?.meta?.usedAI !== false
      if (!resp.ok || !j?.cleaned?.description) {
        throw new Error(j?.error || tr('forumTopic.errors.cleanupFailed'))
      }
      if (!usedAI) {
        toast({ title: tr('forumTopic.toast.reviewUnavailableTitle'), description: tr('forumTopic.toast.tryAgainLater'), variant: 'destructive' })
        return
      }
      const cleaned = String(j.cleaned.description || text).trim()
      if (cleaned === text) {
        toast({ title: tr('forumTopic.toast.textReviewNoChangesTitle'), description: tr('forumTopic.toast.textReviewNoChangesDesc') })
        return
      }
      setContent(cleaned)
      toast({ title: tr('forumTopic.toast.textReviewedTitle'), description: tr('forumTopic.toast.textReviewedDesc') })
    } catch (e: any) {
      toast({
        title: tr('forumTopic.toast.reviewUnavailableTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgainLater'),
        variant: 'destructive',
      })
    } finally {
      setCleaning(false)
    }
  }

  const RECENT_MENTIONS_KEY = 'djt_forum_recent_mentions'

  const readRecentMentions = (): any[] => {
    try {
      const raw = localStorage.getItem(RECENT_MENTIONS_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((x) => x && typeof x.handle === 'string' && x.handle.trim())
        .slice(0, 8)
    } catch {
      return []
    }
  }

  const rememberMention = (item: any) => {
    try {
      const next = {
        kind: item?.kind || 'user',
        handle: String(item?.handle || '').trim(),
        label: String(item?.label || item?.handle || '').trim(),
      }
      if (!next.handle) return
      const prev = readRecentMentions()
      const merged = [next, ...prev.filter((x) => x?.handle !== next.handle)].slice(0, 8)
      localStorage.setItem(RECENT_MENTIONS_KEY, JSON.stringify(merged))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    mentionDraftRef.current = mentionDraft
  }, [mentionDraft])

  useEffect(() => {
    const nextCursor = pendingCursorRef.current
    if (nextCursor == null) return
    pendingCursorRef.current = null
    requestAnimationFrame(() => {
      try {
        const el = composerRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(nextCursor, nextCursor)
      } catch {
        // ignore
      }
    })
  }, [content])

  const detectMentionDraftAtCursor = (text: string, cursor: number) => {
    const cur = Math.max(0, Math.min(text.length, cursor))
    const left = text.slice(0, cur)
    // Allow searching by name (including spaces) while preventing trailing-space drafts.
    // Examples: "@rod" / "@rodrigo ca"
    const match = left.match(/(^|[\s([{<])@([\p{L}0-9_.-]+(?:\s+[\p{L}0-9_.-]+)*)$/u)
    if (!match) return null
    const query = match[2] ?? ''
    const start = cur - query.length - 1
    if (start < 0) return null
    return { start, end: cur, query }
  }

  const syncMentionFromCursor = (text: string, cursor: number) => {
    const next = detectMentionDraftAtCursor(text, cursor)
    mentionDraftRef.current = next
    setMentionDraft(next)
    setMentionQuery(next?.query || '')
    if (!next) {
      setMentionSuggestions([])
      setMentionActiveIndex(0)
    }
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setContent(value)
    const cursor = typeof e.target.selectionStart === 'number' ? e.target.selectionStart : value.length
    syncMentionFromCursor(value, cursor)
  }

  const syncMentionFromComposer = () => {
    const el = composerRef.current
    if (!el) return
    const cursor = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length
    syncMentionFromCursor(el.value, cursor)
  }

  const insertMention = (item: any) => {
    const handle = String(item?.handle || '').trim()
    const draft = mentionDraftRef.current
    if (!handle || !draft) return

    setContent((prev) => {
      const before = prev.slice(0, draft.start)
      const after = prev.slice(draft.end)
      const spacer = after.length === 0 || /^\s/.test(after) ? '' : ' '
      const inserted = `@${handle}${spacer}`
      pendingCursorRef.current = before.length + inserted.length
      return `${before}${inserted}${after}`
    })

    rememberMention(item)
    setMentionDraft(null)
    setMentionQuery('')
    setMentionSuggestions([])
    setMentionActiveIndex(0)
  }

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionDraftRef.current) return
    if (!mentionSuggestions.length) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionActiveIndex((prev) => Math.min(prev + 1, mentionSuggestions.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionActiveIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setMentionDraft(null)
      setMentionQuery('')
      setMentionSuggestions([])
      setMentionActiveIndex(0)
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const picked = mentionSuggestions[mentionActiveIndex]
      if (picked) insertMention(picked)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const picked = mentionSuggestions[mentionActiveIndex]
      if (picked) insertMention(picked)
    }
  }

  const handlePost = async () => {
    if (!id) return
    let text = (content || '').trim()
    if (text.length < 10) {
      toast({
        title: tr('forumTopic.toast.postTooShortTitle'),
        description: tr('forumTopic.toast.postTooShortDesc'),
        variant: 'destructive',
      })
      return
    }
    // Sugestão de hashtags via IA antes de enviar (confirmando com usuário)
    try {
      const resp = await apiFetch('/api/ai?handler=suggest-hashtags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      const json = await resp.json().catch(() => ({}))
      if (resp.ok && Array.isArray(json.hashtags) && json.hashtags.length > 0) {
        const raw = json.hashtags.map((h: any) => String(h || '').trim()).filter(Boolean)
        const proposal = raw.filter((h: string) => !text.includes(h) && !text.includes(h.replace(/^#+/, '')))
        if (proposal.length > 0) {
          const choice = await requestHashtagChoice(proposal, 'addHashtags')
          if (choice !== 'ignore') {
            const tags = formatHashtags(proposal, choice === 'withHash')
            if (tags.length > 0) {
              text = `${text}\n${tags.join(' ')}`
              setContent(text)
            }
          }
        }
      }
    } catch { /* noop */ }
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const parent = replyToPostId ? posts.find(p => p.id === replyToPostId) : undefined
      // Try API route first (service role handles mentions/tagging uniformly)
      try {
        const resp = await fetch('/api/forum?handler=post', {
          method:'POST', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            topic_id: id,
            content_md: text,
            payload: { images: attachmentUrls },
            attachment_urls: attachmentUrls,
            parent_post_id: replyToPostId || null,
            ...(parent?.user_id ? { reply_to_user_id: parent.user_id } : {}),
          })
        })
        const j = await resp.json().catch(()=>({}))
        if (!resp.ok) throw new Error(j?.error || tr('forumTopic.errors.publishFailed'))
        setContent('')
        setAttachmentUrls([])
        setReplyToPostId(null)
        setReplyToExcerpt('')
        load()
        try {
          const isStaff = (Array.isArray(roles) && roles.includes('admin')) || String(userRole || '').includes('gerente') || String(userRole || '').includes('coordenador') || (Array.isArray(roles) && roles.includes('content_curator'))
          if (isStaff && (j as any)?.post?.id) {
            const { data: session } = await supabase.auth.getSession()
            const token = session.session?.access_token
            await fetch('/api/forum?handler=assess-post', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ post_id: (j as any)?.post?.id }),
            })
          }
        } catch { /* noop */ }
        return
      } catch (apiErr:any) {
        // Fallback: direct insert via Supabase client (requires forum_posts to exist and RLS enabled)
        try {
          const { data: userData } = await supabase.auth.getUser()
          const uid = userData.user?.id
          if (!uid) throw apiErr
          // Insert setting both legacy and new columns for compatibility
          const { error: insErr } = await supabase
            .from('forum_posts')
            .insert({
              topic_id: id,
              user_id: uid,
              author_id: uid, // legacy column
              content_md: text,
              content: text, // legacy CHECK enforces length
              payload: { images: attachmentUrls },
              parent_post_id: replyToPostId || null,
              ...(parent?.user_id ? { reply_to_user_id: parent.user_id } : {}),
            })
          if (insErr) throw new Error(insErr.message)
          setContent('')
          setAttachmentUrls([])
          setReplyToPostId(null)
          setReplyToExcerpt('')
          load()
        } catch (fallbackErr:any) {
          const msg = String(fallbackErr?.message || apiErr?.message || tr('forumTopic.errors.publishFailed'))
          if (/forum_posts/i.test(msg) && /does not exist|doesn't exist/i.test(msg)) {
            toast({
              title: tr('forumTopic.toast.forumConfigPendingTitle'),
              description: tr('forumTopic.toast.forumConfigPendingDesc'),
              variant: 'destructive',
            })
          } else {
            toast({ title: tr('forumTopic.toast.publishErrorTitle'), description: msg, variant: 'destructive' })
          }
        }
      }
    } catch (e: any) {
      toast({
        title: tr('forumTopic.toast.publishErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    }
  }

  const handleClose = async () => {
    if (!id) return
    if (!confirm(tr('forumTopic.confirm.closeTopic'))) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=close-topic', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ topic_id: id }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || tr('forumTopic.errors.closeFailed'))
      toast({ title: tr('forumTopic.toast.topicClosedTitle'), description: tr('forumTopic.toast.topicClosedDesc') })
      load()
    } catch (e: any) {
      toast({
        title: tr('forumTopic.toast.closeErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    }
  }

  const isLeaderMod = Boolean(isLeader && studioAccess)
  const isAdmin = (Array.isArray(roles) && roles.includes('admin')) || (typeof userRole === 'string' && userRole.includes('admin'))
  const canDeleteTopic = isAdmin || userRole?.includes?.('gerente_djt') || userRole?.includes?.('gerente_divisao_djtx')
  const canGiveFeedback = Boolean(isLeader || studioAccess || isAdmin)
  const permissionLabel = isAdmin
    ? tr('forumTopic.permission.admin')
    : isLeaderMod
      ? tr('forumTopic.permission.moderator')
      : tr('forumTopic.permission.contributor')

  const startFeedback = (opts: { userId: string | null; name?: string | null; context?: { type: string; url?: string | null; label?: string | null } | null }) => {
    const targetId = String(opts.userId || '').trim()
    if (!targetId) return
    if (targetId === user?.id) {
      toast({ title: 'Você não pode enviar feedback para si mesmo.', variant: 'destructive' })
      return
    }
    setFeedbackTarget({ userId: targetId, name: opts.name || null, context: opts.context || null })
    setFeedbackDialogOpen(true)
  }

  const sendCompendiumToStudio = (kind: 'quiz' | 'desafio' | 'campanha') => {
    if (!topic) return
    const summary = String(translatedSummary || compendium?.summary_md || '')
    const draft = {
      kind,
      title: topic.title,
      summary,
      actions: [],
      chas: topic.chas_dimension || 'C',
      specialties: topic.quiz_specialties || [],
      topic_id: topic.id,
    }
    localStorage.setItem('studio_compendium_draft', JSON.stringify(draft))
    window.location.href = '/studio'
  }

  const handleDeletePost = async (postId: string) => {
    if (!confirm(tr('forumTopic.confirm.deletePost'))) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'delete_post', post_id: postId }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || tr('forumTopic.errors.deletePostFailed'))
      load()
    } catch (e:any) {
      toast({
        title: tr('forumTopic.toast.deletePostErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    }
  }

  const startEditPost = (post: Post) => {
    setEditingPostId(post.id)
    setEditingPostText(post.content_md || '')
  }

  const cancelEditPost = () => {
    setEditingPostId(null)
    setEditingPostText('')
  }

  const handleSavePostEdit = async (post: Post) => {
    let text = (editingPostText || '').trim()
    if (text.length < 10) {
      toast({
        title: tr('forumTopic.toast.postTooShortTitle'),
        description: tr('forumTopic.toast.postTooShortDesc'),
        variant: 'destructive',
      })
      return
    }
    try {
      const resp = await apiFetch('/api/ai?handler=suggest-hashtags', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text })
      })
      const json = await resp.json().catch(()=>({}))
      if (resp.ok && Array.isArray(json.hashtags) && json.hashtags.length > 0) {
        const raw = json.hashtags.map((h: any) => String(h || '').trim()).filter(Boolean)
        const proposal = raw.filter((h: string) => !text.includes(h) && !text.includes(h.replace(/^#+/, '')))
        if (proposal.length > 0) {
          const choice = await requestHashtagChoice(proposal, 'addHashtagsEdited')
          if (choice !== 'ignore') {
            const tags = formatHashtags(proposal, choice === 'withHash')
            if (tags.length > 0) {
              text = `${text}\n${tags.join(' ')}`
              setEditingPostText(text)
            }
          }
        }
      }
    } catch { /* noop */ }
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      if (!token) throw new Error('Não autenticado')
      const resp = await fetch('/api/forum?handler=moderate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action:'update_post', post_id: post.id, content_md: text })
      })
      const j = await resp.json().catch(()=>({}))
      if (!resp.ok) throw new Error(j?.error || tr('forumTopic.errors.saveEditFailed'))
      cancelEditPost()
      load()
      toast({ title: tr('forumTopic.toast.postUpdatedTitle') })
    } catch (e:any) {
      toast({
        title: tr('forumTopic.toast.saveEditErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    }
  }

  const handleCleanExistingPost = async (post: Post) => {
    setCleaningPostId(post.id)
    try {
      const resp = await apiFetch('/api/ai?handler=cleanup-text', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ title: topic?.title || '', description: post.content_md, language: localeToOpenAiLanguageTag(getActiveLocale()) })
      })
      const j = await resp.json().catch(()=>({}))
      const cleaned = j?.cleaned?.description
      const usedAI = j?.meta?.usedAI !== false
      if (!resp.ok || !cleaned) throw new Error(j?.error || tr('forumTopic.errors.cleanupFailed'))
      if (!usedAI) {
        toast({ title: tr('forumTopic.toast.reviewUnavailableTitle'), description: tr('forumTopic.toast.tryAgainLater'), variant: 'destructive' })
        return
      }
      const trimmedCleaned = String(cleaned).trim()
      const trimmedOriginal = String(post.content_md || '').trim()
      if (trimmedCleaned === trimmedOriginal) {
        toast({ title: tr('forumTopic.toast.textReviewNoChangesTitle'), description: tr('forumTopic.toast.textReviewNoChangesDesc') })
        return
      }

      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      if (!token) throw new Error('Não autenticado')
      const save = await fetch('/api/forum?handler=moderate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action:'update_post', post_id: post.id, content_md: trimmedCleaned })
      })
      const j2 = await save.json().catch(()=>({}))
      if (!save.ok) throw new Error(j2?.error || tr('forumTopic.errors.saveReviewFailed'))

      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, content_md: trimmedCleaned } : p))
      try { await load() } catch { /* noop */ }
      toast({ title: tr('forumTopic.toast.textReviewedTitle'), description: tr('forumTopic.toast.textReviewedDesc') })
    } catch (e:any) {
      toast({
        title: tr('forumTopic.toast.reviewErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    } finally {
      setCleaningPostId(null)
    }
  }

  const handleDeleteTopic = async () => {
    if (!id) return
    if (!confirm(tr('forumTopic.confirm.deleteTopic'))) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'delete_topic', topic_id: id }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || tr('forumTopic.errors.deleteTopicFailed'))
      toast({ title: tr('forumTopic.toast.topicDeletedTitle') })
      window.history.back()
    } catch (e:any) {
      toast({
        title: tr('forumTopic.toast.deleteTopicErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    }
  }

  const handleClearTopic = async () => {
    if (!id) return
    if (!confirm(tr('forumTopic.confirm.clearTopic'))) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'clear_topic', topic_id: id }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || tr('forumTopic.errors.clearTopicFailed'))
      toast({ title: tr('forumTopic.toast.topicClearedTitle') })
      load()
    } catch (e:any) {
      toast({
        title: tr('forumTopic.toast.clearTopicErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    }
  }

  const handleUpdateTopic = async () => {
    if (!id) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'update_topic', topic_id: id, update: { title: editTitle, description: editDesc } }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || tr('forumTopic.errors.updateTopicFailed'))
      setEditing(false)
      load()
    } catch (e:any) {
      toast({
        title: tr('forumTopic.toast.updateTopicErrorTitle'),
        description: e?.message || tr('forumTopic.toast.tryAgain'),
        variant: 'destructive',
      })
    }
  }

  if (!topic) return null

  return (
    <div className="relative min-h-screen pb-40">
      <ThemedBackground theme="atitude" />
      <HelpInfo kind="forum" />
      <SendUserFeedbackDialog
        open={feedbackDialogOpen}
        onOpenChange={(open) => {
          setFeedbackDialogOpen(open)
          if (!open) setFeedbackTarget(null)
        }}
        recipientId={feedbackTarget?.userId || null}
        recipientName={feedbackTarget?.name || null}
        context={feedbackTarget?.context || null}
      />
      <Dialog
        open={hashtagDialogOpen}
        onOpenChange={(open) => {
          if (!open) resolveHashtagChoice('ignore')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr('forumTopic.hashtagsDialog.title')}</DialogTitle>
            <DialogDescription>
              {tr(`forumTopic.confirm.${hashtagDialogVariant}`, { hashtags: hashtagDialogTags.join(' ') })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => resolveHashtagChoice('ignore')}>
              {tr('forumTopic.hashtagsDialog.ignore')}
            </Button>
            <Button variant="outline" onClick={() => resolveHashtagChoice('withoutHash')}>
              {tr('forumTopic.hashtagsDialog.applyWithoutHash')}
            </Button>
            <Button onClick={() => resolveHashtagChoice('withHash')}>
              {tr('forumTopic.hashtagsDialog.applyWithHash')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="container relative mx-auto p-4 md:p-6 max-w-5xl space-y-4">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2 md:max-w-xl">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/forums')}
                  className="-ml-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {tr('forumTopic.backToForums')}
                </Button>
                {editing ? (
                  <div className="space-y-3 rounded-2xl border border-white/10 bg-black/35 p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{tr('forumTopic.edit.aiHint')}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={async () => {
                          const textTitle = editTitle.trim()
                          const textDesc = editDesc.trim()
                          if (!textTitle && !textDesc) return
                          try {
                            const resp = await apiFetch('/api/ai?handler=cleanup-text', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ title: textTitle, description: textDesc, language: localeToOpenAiLanguageTag(getActiveLocale()) })
                            })
                            const j = await resp.json().catch(() => ({}))
                            if (!resp.ok || !j?.cleaned) throw new Error(j?.error || tr('forumTopic.errors.aiCleanupFailed'))
                            if (typeof j.cleaned.title === 'string' && j.cleaned.title.trim()) {
                              setEditTitle(j.cleaned.title)
                            }
                            if (typeof j.cleaned.description === 'string' && j.cleaned.description.trim()) {
                              setEditDesc(j.cleaned.description)
                            }
                          } catch (e:any) {
                            toast({
                              title: tr('forumTopic.toast.aiCleanupErrorTitle'),
                              description: e?.message || tr('forumTopic.toast.tryAgain'),
                              variant: 'destructive',
                            })
                          }
                        }}
                        title={tr('forumTopic.edit.reviewAria')}
                      >
                        <Wand2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Input
                      value={editTitle}
                      onChange={(e)=>setEditTitle(e.target.value)}
                      className="bg-black/60 border-white/20"
                    />
                    <Textarea
                      rows={3}
                      value={editDesc}
                      onChange={(e)=>setEditDesc(e.target.value)}
                      className="bg-black/60 border-white/20"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" onClick={handleUpdateTopic}>{tr('forumTopic.actions.save')}</Button>
                      <Button size="sm" variant="outline" onClick={()=>{ setEditing(false); }}>{tr('forumTopic.actions.cancel')}</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <CardTitle className="text-xl font-bold break-words sm:text-2xl">{topicTitle}</CardTitle>
                    <CardDescription className="whitespace-pre-line text-sm sm:text-base">{topicDescription}</CardDescription>
                    {isTranslating && (
                      <p className="text-[11px] text-muted-foreground">
                        {tr('forumTopic.translationRunning')}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-col items-start gap-2 w-full md:w-auto md:items-end">
                <div className="flex flex-wrap items-center gap-2 text-[11px] md:justify-end">
                  <Badge variant={topic.status === 'closed' ? 'secondary' : 'default'}>
                    {statusLabel}
                  </Badge>
                  <span className="text-muted-foreground text-left md:text-right md:max-w-xs">
                    {permissionLabel}
                  </span>
                </div>
	                <div className="flex flex-wrap gap-2.5 p-1.5 rounded-lg border border-white/10 bg-black/20 md:justify-end">
	                  <Button
	                    size="sm"
	                    variant="outline"
	                    onClick={() => navigate(`/forums/insights?topic_id=${encodeURIComponent(id || '')}`)}
	                    disabled={!id}
	                    className="h-8 px-3 text-[11px]"
	                  >
	                    {tr('forums.topThemesButton')}
	                  </Button>
                  {id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(id)}`)
                        openWhatsAppShare({
                          message: tr('dashboard.forumShareMessage', { title: topicTitle }),
                          url,
                        })
                      }}
                      title={tr('dashboard.forumShareAria')}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  )}
                  {id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={isSpeaking}
                      onClick={() => speakText([topicTitle, topicDescription || ''].filter(Boolean).join('\n\n'))}
                      title={tr('forumTopic.listenForum')}
                      aria-label={tr('forumTopic.listenForum')}
                    >
                      <Volume2 className="h-4 w-4" />
                    </Button>
                  )}
	                  {isLeaderMod && topic.status !== 'closed' && (
	                    <Button size="sm" onClick={handleClose} className="h-8 px-3 text-[11px]">
	                      {tr('forumTopic.actions.closeAndCurate')}
	                    </Button>
	                  )}
	                  {isLeaderMod && !editing && (
	                    <Button
	                      size="sm"
	                      variant="outline"
	                      onClick={() => {
	                        setEditing(true)
	                        setEditTitle(topic.title)
	                        setEditDesc(topic.description || '')
	                      }}
	                      className="h-8 px-3 text-[11px]"
	                    >
	                      {tr('forumTopic.actions.edit')}
	                    </Button>
	                  )}
	                  {isLeaderMod && (
	                    <>
	                      <Button
	                        size="sm"
	                        variant="outline"
	                        onClick={handleClearTopic}
	                        className="h-8 px-3 text-[11px]"
	                      >
	                        {tr('forumTopic.actions.clear')}
	                      </Button>
	                      {canDeleteTopic && (
	                        <Button
	                          size="sm"
	                          variant="destructive"
	                          onClick={handleDeleteTopic}
	                          className="h-8 px-3 text-[11px]"
	                        >
	                          {tr('forumTopic.actions.delete')}
	                        </Button>
	                      )}
	                    </>
	                  )}
	                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {topic.quiz_specialties?.map(s => (<Badge key={s} variant="outline">{s}</Badge>))}
              {topic.tags?.map(tag => (<Badge key={tag} className="bg-primary/10">#{tag}</Badge>))}
            </div>
          </CardHeader>
        </Card>

        {(compendium?.summary_md || compendium?.key_learnings || compendium?.suggested_quizzes || compendium?.suggested_challenges) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{tr('forumTopic.compendium.title')}</CardTitle>
              <CardDescription>
                {tr('forumTopic.compendium.subtitle')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {summaryText && (
                <div className="text-sm whitespace-pre-wrap">{String(summaryText)}</div>
              )}

              {Array.isArray(compendium?.key_learnings) && compendium.key_learnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{tr('forumTopic.compendium.keyLearnings')}</p>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {compendium.key_learnings.slice(0, 12).map((k: any, idx: number) => (
                      <li key={idx}>{String(k)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(() => {
                const urls = new Set<string>()
                for (const p of posts || []) {
                  const list =
                    ((p as any)?.payload?.attachments ||
                      (p as any)?.payload?.images ||
                      (p as any)?.attachment_urls) as string[] | undefined
                  if (!Array.isArray(list)) continue
                  for (const u of list) {
                    if (u) urls.add(String(u))
                  }
                }
                const all = Array.from(urls)
                if (!all.length) return null
                return (
                  <div>
                    <p className="text-sm font-semibold">{tr('forumTopic.compendium.attachments')}</p>
                    <AttachmentViewer urls={all} />
                  </div>
                )
              })()}

              {isLeaderMod && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => sendCompendiumToStudio('quiz')}>
                    {tr('forumTopic.compendium.createQuiz')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sendCompendiumToStudio('desafio')}>
                    {tr('forumTopic.compendium.createChallenge')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sendCompendiumToStudio('campanha')}>
                    {tr('forumTopic.compendium.createCampaign')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {posts
            .filter((p) => !p.parent_post_id)
            .map((p) => {
              const replies = posts.filter((r) => r.parent_post_id === p.id)
              const postText = translatedPosts[p.id] || postLocalTranslations[p.id] || p.content_md
              const authorId = p.user_id || (p as any).author_id || null
              const authorName = p.author?.name || tr('forumTopic.author.fallback')
              const authorTeam = p.author?.sigla_area || null
              const urls =
                ((p as any)?.payload?.attachments ||
                  (p as any)?.payload?.images ||
                  (p as any)?.attachment_urls) as string[] | undefined
              const hasAttachments = Array.isArray(urls) && urls.length > 0
              const isDeleted = Boolean((p as any)?.payload?.deleted) || (!String(postText || '').trim() && !hasAttachments)
              const wasEdited = Boolean((p as any)?.is_edited || (p as any)?.edited_at)
              return (
            <Card key={p.id} id={`post-${p.id}`}>
              <CardContent className="p-4 space-y-2">
                {editingPostId === p.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{tr('forumTopic.postEdit.aiHint')}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={async () => {
                          const source = (editingPostText || '').trim()
                          if (source.length < 3) return
                          try {
                            const resp = await apiFetch('/api/ai?handler=cleanup-text', {
                              method:'POST',
                              headers:{ 'Content-Type':'application/json' },
                              body: JSON.stringify({ title: topic?.title || '', description: source, language: localeToOpenAiLanguageTag(getActiveLocale()) })
                            })
                            const j = await resp.json().catch(()=>({}))
                            const cleaned = j?.cleaned?.description
                            const usedAI = j?.meta?.usedAI !== false
                            if (!resp.ok || !cleaned) throw new Error(j?.error || tr('forumTopic.errors.aiCleanupFailed'))
                            if (!usedAI) {
                              toast({
                                title: tr('forumTopic.toast.reviewUnavailableTitle'),
                                description: tr('forumTopic.toast.tryAgainLater'),
                                variant: 'destructive',
                              })
                              return
                            }
                            const next = String(cleaned).trim()
                            if (next === source) {
                              toast({ title: tr('forumTopic.toast.textReviewNoChangesTitle'), description: tr('forumTopic.toast.textReviewNoChangesDesc') })
                              return
                            }
                            setEditingPostText(next)
                          } catch (e:any) {
                            toast({
                              title: tr('forumTopic.toast.aiCleanupErrorTitle'),
                              description: e?.message || tr('forumTopic.toast.tryAgain'),
                              variant: 'destructive',
                            })
                          }
                        }}
                      >
                        <Wand2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      rows={3}
                      value={editingPostText}
                      onChange={(e)=>setEditingPostText(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={cancelEditPost}>{tr('forumTopic.actions.cancel')}</Button>
                      <Button size="sm" onClick={()=>handleSavePostEdit(p)}>{tr('forumTopic.actions.save')}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <UserProfilePopover userId={authorId} name={authorName} avatarUrl={p.author?.avatar_thumbnail_url || null}>
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={p.author?.avatar_thumbnail_url || undefined} alt={authorName} />
                            <AvatarFallback>{initials(authorName)}</AvatarFallback>
                          </Avatar>
                        </UserProfilePopover>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <UserProfilePopover userId={authorId} name={authorName} avatarUrl={p.author?.avatar_thumbnail_url || null}>
                              <button type="button" className="text-[13px] font-semibold truncate">
                                {formatName(authorName)}
                              </button>
                            </UserProfilePopover>
                            {authorTeam ? <span className="text-[12px] text-muted-foreground truncate">{authorTeam}</span> : null}
                            {wasEdited ? <span className="text-[11px] text-muted-foreground">{tr('forumTopic.post.edited')}</span> : null}
                          </div>
                          {isDeleted ? (
                            <div className="text-[13px] italic text-muted-foreground">{tr('forumTopic.post.deleted')}</div>
                          ) : (
                            <div className="text-sm whitespace-pre-wrap break-words">{postText}</div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="w-full shrink-0 sm:w-auto">
                      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 p-1.5 sm:flex-nowrap sm:justify-end">
	                        <Button
	                          type="button"
	                          size="icon"
	                          variant="ghost"
	                          className="h-9 w-9"
	                          onClick={() => sharePostToWhatsApp(p.id, postText)}
	                          title={tr('forumTopic.post.shareAria')}
	                          aria-label={tr('forumTopic.post.shareAria')}
	                        >
	                          <Share2 className="h-4 w-4" />
	                        </Button>
	                        <Button
	                          type="button"
	                          size="icon"
	                          variant="ghost"
	                          className="h-9 w-9"
	                          disabled={isSpeaking}
	                          onClick={() => speakText(postText)}
	                          title={tr('forumTopic.post.listenAria')}
	                          aria-label={tr('forumTopic.post.listenAria')}
	                        >
	                          <Volume2 className="h-4 w-4" />
	                        </Button>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9"
                              onClick={() => togglePostLike(p)}
                              title={p.has_liked ? "Descurtir" : "Curtir"}
                              aria-label={p.has_liked ? "Descurtir" : "Curtir"}
                              disabled={likingPosts[p.id]}
                            >
                              <Heart className={`h-4 w-4 ${p.has_liked ? "fill-red-500 text-red-500" : ""}`} />
                            </Button>
                            <span className="text-[11px] text-muted-foreground">{p.likes_count || 0}</span>
                          </div>
	                        <Button
	                          type="button"
	                          size="sm"
	                          variant="outline"
	                          className="h-9 px-3 text-[11px]"
	                          onClick={() => {
	                            setReplyToPostId(p.id)
	                            setReplyToExcerpt((postText || tr('forumTopic.post.deleted')).slice(0, 140))
	                          }}
	                        >
	                          <Reply className="h-4 w-4" />
	                          {tr('forumTopic.actions.reply')}
	                        </Button>
	                        <DropdownMenu>
	                          <DropdownMenuTrigger asChild>
	                            <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label="Mais ações">
	                              <MoreVertical className="h-4 w-4" />
	                            </Button>
	                          </DropdownMenuTrigger>
	                          <DropdownMenuContent align="end" className="min-w-[190px]">
                              {canGiveFeedback && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    startFeedback({
                                      userId: authorId,
                                      name: p.author?.name || null,
                                      context: {
                                        type: 'forum_post',
                                        url: `/forum/${encodeURIComponent(id || '')}#post-${encodeURIComponent(p.id)}`,
                                        label: topicTitle ? `Fórum: ${topicTitle}` : 'Fórum',
                                      },
                                    })
                                  }
                                >
                                  <MessageSquare className="h-4 w-4 mr-2" />
                                  Feedback
                                </DropdownMenuItem>
                              )}
	                            {!isDeleted && (isAdmin || p.user_id === user?.id) && (
	                              <DropdownMenuItem
	                                onClick={() => handleCleanExistingPost(p)}
	                                disabled={cleaningPostId === p.id}
	                              >
	                                <Wand2 className="h-4 w-4 mr-2" />
	                                {tr('forumTopic.post.reviewAi')}
	                              </DropdownMenuItem>
	                            )}
	                            {!isDeleted && (p.user_id === user?.id || (p as any).author_id === user?.id) && (
	                              <>
	                                <DropdownMenuItem onClick={() => startEditPost(p)}>
	                                  <Pencil className="h-4 w-4 mr-2" />
	                                  {tr('forumTopic.actions.edit')}
	                                </DropdownMenuItem>
	                              </>
	                            )}
	                            {!isDeleted && (isAdmin || p.user_id === user?.id || (p as any).author_id === user?.id) && (
	                              <DropdownMenuItem
	                                onClick={() => handleDeletePost(p.id)}
	                                className="text-destructive focus:text-destructive"
	                              >
	                                <Trash2 className="h-4 w-4 mr-2" />
	                                  {tr('forumTopic.actions.delete')}
	                                </DropdownMenuItem>
	                            )}
	                          </DropdownMenuContent>
	                        </DropdownMenu>
	                      </div>
	                    </div>
	                  </div>
	                )}
                {Array.isArray(urls) && urls.length > 0 ? <AttachmentViewer urls={urls} postId={p.id} /> : null}
                {p.ai_assessment && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {tr('forumTopic.post.qualityLabel')}: {(p.ai_assessment.helpfulness ?? 0).toFixed(2)} / {(p.ai_assessment.clarity ?? 0).toFixed(2)} / {(p.ai_assessment.novelty ?? 0).toFixed(2)}
                  </div>
                )}
                {replies.length > 0 && (
                  <div className="mt-3 space-y-2 border-l border-border/40 pl-3">
                    {replies.map((r) => {
                      const replyText = translatedPosts[r.id] || postLocalTranslations[r.id] || r.content_md
                      const replyAuthorId = r.user_id || (r as any).author_id || null
                      const replyAuthorName = r.author?.name || tr('forumTopic.author.fallback')
                      const replyAuthorTeam = r.author?.sigla_area || null
                      const replyUrls =
                        ((r as any)?.payload?.attachments ||
                          (r as any)?.payload?.images ||
                          (r as any)?.attachment_urls) as string[] | undefined
                      const replyHasAttachments = Array.isArray(replyUrls) && replyUrls.length > 0
                      const replyIsDeleted =
                        Boolean((r as any)?.payload?.deleted) || (!String(replyText || '').trim() && !replyHasAttachments)
                      const replyWasEdited = Boolean((r as any)?.is_edited || (r as any)?.edited_at)
                      return (
                      <div key={r.id} id={`post-${r.id}`} className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-start gap-2">
                            <UserProfilePopover userId={replyAuthorId} name={replyAuthorName} avatarUrl={r.author?.avatar_thumbnail_url || null}>
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={r.author?.avatar_thumbnail_url || undefined} alt={replyAuthorName} />
                                <AvatarFallback>{initials(replyAuthorName)}</AvatarFallback>
                              </Avatar>
                            </UserProfilePopover>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[11px] text-muted-foreground">{tr('forumTopic.reply.label')}</span>
                                <UserProfilePopover userId={replyAuthorId} name={replyAuthorName} avatarUrl={r.author?.avatar_thumbnail_url || null}>
                                  <button type="button" className="text-[12px] font-semibold truncate text-foreground/90">
                                    {formatName(replyAuthorName)}
                                  </button>
                                </UserProfilePopover>
                                {replyAuthorTeam ? (
                                  <span className="text-[11px] text-muted-foreground truncate">{replyAuthorTeam}</span>
                                ) : null}
                                {replyWasEdited ? (
                                  <span className="text-[11px] text-muted-foreground">{tr('forumTopic.post.edited')}</span>
                                ) : null}
                              </div>
                              {replyIsDeleted ? (
                                <div className="text-[13px] italic text-muted-foreground">{tr('forumTopic.post.deleted')}</div>
                              ) : (
                                <div className="break-words text-foreground/90">{replyText}</div>
                              )}
                            </div>
                          </div>
                          {Array.isArray(replyUrls) && replyUrls.length > 0 ? <AttachmentViewer urls={replyUrls} postId={r.id} /> : null}
                        </div>
                        <div className="w-full shrink-0 sm:w-auto">
                          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 p-1.5 sm:flex-nowrap sm:justify-end">
	                            <Button
	                              type="button"
	                              size="icon"
	                              variant="ghost"
	                              className="h-9 w-9"
	                              onClick={() => sharePostToWhatsApp(r.id, replyText)}
	                              title={tr('forumTopic.post.shareAria')}
	                              aria-label={tr('forumTopic.post.shareAria')}
	                            >
	                              <Share2 className="h-4 w-4" />
	                            </Button>
	                            <Button
	                              type="button"
	                              size="icon"
	                              variant="ghost"
	                              className="h-9 w-9"
	                              disabled={isSpeaking}
	                              onClick={() => speakText(replyText)}
	                              title={tr('forumTopic.reply.listenAria')}
	                              aria-label={tr('forumTopic.reply.listenAria')}
	                            >
	                              <Volume2 className="h-4 w-4" />
	                            </Button>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9"
                                  onClick={() => togglePostLike(r)}
                                  title={r.has_liked ? "Descurtir" : "Curtir"}
                                  aria-label={r.has_liked ? "Descurtir" : "Curtir"}
                                  disabled={likingPosts[r.id]}
                                >
                                  <Heart className={`h-4 w-4 ${r.has_liked ? "fill-red-500 text-red-500" : ""}`} />
                                </Button>
                                <span className="text-[11px] text-muted-foreground">{r.likes_count || 0}</span>
                              </div>
	                            <Button
	                              type="button"
	                              size="sm"
	                              variant="outline"
	                              className="h-9 px-3 text-[11px]"
	                              onClick={() => {
	                                setReplyToPostId(r.id)
	                                setReplyToExcerpt((replyText || tr('forumTopic.post.deleted')).slice(0, 140))
	                              }}
	                            >
	                              <Reply className="h-4 w-4" />
	                              {tr('forumTopic.actions.reply')}
	                            </Button>
	                            {(canGiveFeedback || r.user_id === user?.id || (r as any).author_id === user?.id) && (
	                              <DropdownMenu>
	                                <DropdownMenuTrigger asChild>
	                                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label="Mais ações">
	                                    <MoreVertical className="h-4 w-4" />
	                                  </Button>
	                                </DropdownMenuTrigger>
	                                <DropdownMenuContent align="end" className="min-w-[190px]">
                                    {canGiveFeedback && (
                                      <DropdownMenuItem
                                        onClick={() =>
                                          startFeedback({
                                            userId: replyAuthorId,
                                            name: r.author?.name || null,
                                            context: {
                                              type: 'forum_post',
                                              url: `/forum/${encodeURIComponent(id || '')}#post-${encodeURIComponent(r.id)}`,
                                              label: topicTitle ? `Fórum: ${topicTitle}` : 'Fórum',
                                            },
                                          })
                                        }
                                      >
                                        <MessageSquare className="h-4 w-4 mr-2" />
                                        Feedback
                                      </DropdownMenuItem>
                                    )}
	                                  {!replyIsDeleted && (r.user_id === user?.id || (r as any).author_id === user?.id) && (
	                                    <DropdownMenuItem onClick={() => startEditPost(r)}>
	                                      <Pencil className="h-4 w-4 mr-2" />
	                                      {tr('forumTopic.actions.edit')}
	                                    </DropdownMenuItem>
	                                  )}
	                                </DropdownMenuContent>
	                              </DropdownMenu>
	                            )}
	                            {!replyIsDeleted && (isAdmin || r.user_id === user?.id || (r as any).author_id === user?.id) && (
	                              <Button
	                                type="button"
	                                size="icon"
	                                variant="ghost"
	                                className="h-9 w-9 text-destructive"
	                                onClick={() => handleDeletePost(r.id)}
	                                aria-label={tr('forumTopic.actions.delete')}
	                                title={tr('forumTopic.actions.delete')}
	                              >
	                                <Trash2 className="h-4 w-4" />
	                              </Button>
	                            )}
	                          </div>
	                        </div>
	                      </div>
	                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
              )
            })}
        </div>

        {topic.status !== 'closed' && (
          <Card>
            <CardHeader>
              <CardTitle>{tr('forumTopic.newPost.title')}</CardTitle>
              <CardDescription>{tr('forumTopic.newPost.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    {replyToPostId
                      ? tr('forumTopic.newPost.hint.replying')
                      : tr('forumTopic.newPost.hint.default')}
                  </p>
                  {replyToPostId && (
                    <div className="text-[11px] text-muted-foreground border border-dashed border-border/60 rounded px-2 py-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <span className="break-words sm:truncate">
                        <span className="font-semibold mr-1">{tr('forumTopic.newPost.replyTargetLabel')}:</span>
                        {replyToExcerpt || '...'}
                      </span>
	                      <Button
	                        type="button"
	                        size="sm"
	                        variant="ghost"
	                        className="h-7 px-2 text-[11px]"
	                        onClick={() => {
	                          setReplyToPostId(null)
	                          setReplyToExcerpt('')
	                        }}
	                      >
                        {tr('forumTopic.actions.cancelReply')}
                      </Button>
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={handleCleanupContent}
                  disabled={cleaning}
                  title={tr('forumTopic.newPost.cleanupAria')}
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                ref={composerRef}
                rows={4}
                value={content}
                onChange={handleContentChange}
                onClick={syncMentionFromComposer}
                onKeyUp={syncMentionFromComposer}
                onSelect={syncMentionFromComposer}
                onKeyDown={handleComposerKeyDown}
                placeholder={tr('forumTopic.newPost.placeholder')}
              />
              {mentionSuggestions.length > 0 && mentionDraft && (
                <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  {mentionSuggestions.map((s, idx) => (
                    <button
                      key={`${s.kind}-${s.handle}-${idx}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        insertMention(s)
                      }}
                      className={`px-2 py-0.5 rounded-full border border-muted-foreground/40 bg-background/60 hover:bg-muted ${
                        idx === mentionActiveIndex ? 'bg-muted text-foreground' : ''
                      }`}
                    >
                      <span className="font-semibold">
                        {s.label || s.handle}
                      </span>
                      {s.kind === 'user' && (
                        <span className="ml-1 opacity-70">@{s.handle}</span>
                      )}
                      {s.kind === 'team' && (
                        <span className="ml-1 opacity-70">{tr('forumTopic.mentions.teamSuffix', { handle: s.handle })}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <VoiceRecorderButton
                  size="sm"
                  label={tr('forumTopic.audio.record')}
                  onText={(text) => setContent((prev) => [prev, text].filter(Boolean).join('\n\n'))}
                />
                <Dialog open={composerPlusOpen} onOpenChange={setComposerPlusOpen}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="relative h-10 w-10 rounded-full"
                      title="Anexos e áudio"
                      aria-label="Anexos e áudio"
                    >
                      <Plus className="h-5 w-5" />
                      {attachmentsUploading && (
                        <span
                          className="absolute -bottom-1 -right-1 inline-flex h-3 w-3 rounded-full bg-amber-400"
                          aria-label="Enviando anexos"
                          title="Enviando…"
                        />
                      )}
                      {attachmentUrls.length > 0 && (
                        <Badge className="absolute -top-2 -right-2 h-5 min-w-[20px] justify-center px-1 text-[10px]">
                          {attachmentUrls.length}
                        </Badge>
                      )}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Anexos</DialogTitle>
                      <DialogDescription>
                        No celular, você pode tirar foto pela câmera ou selecionar arquivos.
                      </DialogDescription>
                    </DialogHeader>
                    <Tabs defaultValue="attachments">
                      <TabsList className="w-full">
                        <TabsTrigger value="attachments" className="flex-1">Arquivos</TabsTrigger>
                        <TabsTrigger value="audio" className="flex-1">Áudio</TabsTrigger>
                      </TabsList>
                      <TabsContent value="attachments" className="space-y-3">
                        <AttachmentUploader
                          onAttachmentsChange={setAttachmentUrls}
                          onUploadingChange={setAttachmentsUploading}
                          maxFiles={6}
                          maxSizeMB={50}
                          maxVideoSeconds={90}
                          capture="environment"
                        />
                        {attachmentUrls.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {attachmentUrls.map((url) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border bg-background/80 px-2 py-1 text-xs text-foreground"
                              >
                                Anexo
                              </a>
                            ))}
                          </div>
                        )}
                        {attachmentsUploading && (
                          <p className="text-[11px] text-muted-foreground">{tr('forumTopic.attachments.uploading')}</p>
                        )}
                      </TabsContent>
                      <TabsContent value="audio" className="space-y-3">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <VoiceRecorderButton
                              size="sm"
                              label={tr('forumTopic.audio.record')}
                              onText={(text) => setContent(prev => [prev, text].filter(Boolean).join('\n\n'))}
                            />
                            <Input type="file" accept="audio/*" onChange={(e)=>setAudioFile(e.target.files?.[0] || null)} className="sm:max-w-[360px]" />
                            {audioFile && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => setAudioFile(null)}>
                                {tr('forumTopic.audio.remove')}
                              </Button>
                            )}
                            <Button variant="outline" disabled={!audioFile || transcribing} onClick={handleTranscribe}>
                              {transcribing ? tr('forumTopic.audio.transcribing') : tr('forumTopic.audio.organize')}
                            </Button>
                          </div>
                          {audioPreviewUrl && (
                            <audio controls src={audioPreviewUrl} className="w-full" />
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            {tr('forumTopic.audio.hint')}
                          </p>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="flex justify-end">
                <Button onClick={handlePost} disabled={!content.trim() || attachmentsUploading}>{tr('forumTopic.actions.publish')}</Button>
              </div>
            </CardContent>
          </Card>
        )}
              </div>
              <Navigation />
            </div>
  )
}
