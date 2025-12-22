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
import { VoiceRecorderButton } from '@/components/VoiceRecorderButton'
import Navigation from '@/components/Navigation'
import { Wand2, Share2, Volume2 } from 'lucide-react'
import { buildAbsoluteAppUrl, openWhatsAppShare } from '@/lib/whatsappShare'
import { useTts } from '@/lib/tts'
import { getActiveLocale } from '@/lib/i18n/activeLocale'
import { localeToOpenAiLanguageTag, localeToSpeechLanguage } from '@/lib/i18n/language'
import { useI18n } from '@/contexts/I18nContext'
import { translateTextsCached } from '@/lib/i18n/aiTranslate'

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
  content_md: string;
  payload: any;
  created_at: string;
  ai_assessment: any;
  parent_post_id?: string | null;
  reply_to_user_id?: string | null;
  translations?: Record<string, string> | null;
  author?: {
    name: string | null;
    sigla_area: string | null;
  } | null;
}

export default function ForumTopic() {
  const { topicId: id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { isLeader, studioAccess, user, userRole } = useAuth() as any
  const { locale } = useI18n()
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
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [editingPostText, setEditingPostText] = useState<string>('')
  const [mentionQuery, setMentionQuery] = useState<string>('')
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([])
  const [cleaningPostId, setCleaningPostId] = useState<string | null>(null)
  const [replyToPostId, setReplyToPostId] = useState<string | null>(null)
  const [replyToExcerpt, setReplyToExcerpt] = useState<string>('')
  const [translatedTopic, setTranslatedTopic] = useState<{ title?: string; description?: string }>({})
  const [translatedPosts, setTranslatedPosts] = useState<Record<string, string>>({})
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null)
  const [postLocalTranslations, setPostLocalTranslations] = useState<Record<string, string>>({})
  const [isTranslating, setIsTranslating] = useState(false)
  const didScrollToHashRef = useRef(false)
  const translatingRef = useRef(false)

  const speakText = useCallback(
    async (text: string) => {
      const cleaned = String(text || '').trim()
      if (!cleaned) return
      if (!ttsEnabled) {
        toast({ title: 'Ative a leitura em voz no menu do perfil.' })
        return
      }
      try {
        await speak(cleaned)
      } catch (e: any) {
        toast({ title: 'Falha ao gerar áudio', description: e?.message || 'Tente novamente', variant: 'destructive' })
      }
    },
    [speak, toast, ttsEnabled],
  )

  const load = useCallback(async () => {
    if (!id) return
    const [{ data: t }, { data: p }, { data: c }] = await Promise.all([
      supabase.from('forum_topics').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('forum_posts')
        .select('id,user_id,content_md,translations,payload,created_at,ai_assessment,parent_post_id,reply_to_user_id,author:profiles!forum_posts_author_id_fkey(name,sigla_area)')
        .eq('topic_id', id)
        .order('created_at', { ascending: true }),
      supabase.from('forum_compendia').select('*').eq('topic_id', id).maybeSingle(),
    ])
    setTopic(t as any)
    setPosts((p || []) as any)
    setCompendium((c as any) || null)
  }, [id])

  useEffect(() => { load() }, [load])

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
    const t = setTimeout(async () => {
      const q = mentionQuery.trim()
      if (!q || q.length < 1) {
        if (!cancelled) setMentionSuggestions([])
        return
      }
      try {
        const resp = await fetch(`/api/sepbook-mention-suggest?q=${encodeURIComponent(q)}`)
        const json = await resp.json()
        if (!resp.ok) throw new Error(json?.error || 'Falha ao sugerir menções')
        if (!cancelled) setMentionSuggestions(json.items || [])
      } catch {
        if (!cancelled) setMentionSuggestions([])
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [mentionQuery])

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
        throw new Error('Arquivo muito grande. Envie um áudio menor (até 12MB).')
      }
      const toBase64 = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(f) })
      const b64 = await toBase64(audioFile)
      const resp = await fetch('/api/ai?handler=transcribe-audio', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ audioBase64: b64, mode:'organize', language: localeToSpeechLanguage(getActiveLocale()) }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha na transcrição')
      setContent(prev => [prev, j.text || j.transcript].filter(Boolean).join('\n\n'))
      toast({ title: 'Áudio organizado e inserido no post' })
    } catch (e: any) {
      toast({ title: 'Erro ao transcrever', description: e?.message || 'Tente novamente', variant: 'destructive' })
    } finally { setTranscribing(false) }
  }

  const handleCleanupContent = async () => {
    const text = (content || '').trim()
    if (text.length < 3) {
      toast({ title: 'Nada para revisar', description: 'Digite o texto antes de pedir correção.', variant: 'default' })
      return
    }
    try {
      setCleaning(true)
      const resp = await fetch('/api/ai?handler=cleanup-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: topic?.title || '', description: text, language: localeToOpenAiLanguageTag(getActiveLocale()) })
      })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok || !j?.cleaned?.description) {
        throw new Error(j?.error || 'Falha na revisão automática')
      }
      setContent(String(j.cleaned.description || text))
      toast({ title: 'Texto revisado', description: 'Ortografia e pontuação ajustadas, conteúdo preservado.' })
    } catch (e: any) {
      toast({ title: 'Não foi possível revisar agora', description: e?.message || 'Tente novamente mais tarde.', variant: 'destructive' })
    } finally {
      setCleaning(false)
    }
  }

  const handleContentChange = (value: string) => {
    setContent(value)
    // Detecta a última menção digitada e só sugere se o cursor estiver logo depois dela
    const matches = Array.from(value.matchAll(/@([A-Za-z0-9_.-]{2,30})/g))
    if (matches.length > 0) {
      const last = matches[matches.length - 1]
      const endIndex = (last.index ?? 0) + last[0].length
      if (endIndex === value.length) {
        setMentionQuery(last[1] || '')
      } else {
        setMentionQuery('')
      }
    } else {
      setMentionQuery('')
    }
  }

  const handlePost = async () => {
    if (!id) return
    let text = (content || '').trim()
    if (text.length < 10) {
      toast({ title: 'Conteúdo muito curto', description: 'Escreva ao menos 10 caracteres', variant: 'destructive' })
      return
    }
    // Sugestão de hashtags via IA antes de enviar (confirmando com usuário)
    try {
      const resp = await fetch('/api/ai?handler=suggest-hashtags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      const json = await resp.json().catch(() => ({}))
      if (resp.ok && Array.isArray(json.hashtags) && json.hashtags.length > 0) {
        const proposal = json.hashtags.filter((h: string) => !text.includes(h))
        if (proposal.length > 0) {
          const msg = `Sugerimos adicionar estas hashtags:\n${proposal.join(' ')}\n\nAdicionar antes de enviar?`
          if (confirm(msg)) {
            text = `${text}\n${proposal.join(' ')}`
            setContent(text)
          }
        }
      }
    } catch {}
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
        if (!resp.ok) throw new Error(j?.error || 'Falha ao publicar')
        setContent('')
        setAttachmentUrls([])
        setReplyToPostId(null)
        setReplyToExcerpt('')
        load()
        try { await fetch('/api/forum?handler=assess-post', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ post_id: (j as any)?.post?.id }) }) } catch {}
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
          const msg = String(fallbackErr?.message || apiErr?.message || 'Falha ao publicar')
          if (/forum_posts/i.test(msg) && /does not exist|doesn't exist/i.test(msg)) {
            toast({ title: 'Configuração do fórum pendente', description: 'Aplique a migração forum_core no Supabase para habilitar posts.', variant: 'destructive' })
          } else {
            toast({ title: 'Erro ao publicar', description: msg, variant: 'destructive' })
          }
        }
      }
    } catch (e: any) {
      toast({ title: 'Erro ao publicar', description: e?.message || 'Tente novamente', variant: 'destructive' })
    }
  }

  const handleClose = async () => {
    if (!id) return
    if (!confirm('Fechar este tema e gerar compêndio?')) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=close-topic', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ topic_id: id }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha ao fechar')
      toast({ title: 'Tema fechado', description: 'Compêndio gerado.' })
      load()
    } catch (e: any) {
      toast({ title: 'Erro ao fechar', description: e?.message || 'Tente novamente', variant: 'destructive' })
    }
  }

  const isLeaderMod = Boolean(isLeader && studioAccess)
  const canDeleteTopic = typeof userRole === 'string' && (userRole.includes('admin') || userRole.includes('gerente_djt') || userRole.includes('gerente_divisao_djtx'))
  const permissionLabel = canDeleteTopic
    ? 'Permissão: Admin — editar, limpar e excluir tópico'
    : isLeaderMod
      ? 'Permissão: Moderador — editar e limpar tópico'
      : 'Permissão: Colaborador — leitura e comentários'

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
    if (!confirm('Excluir este post definitivamente?')) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'delete_post', post_id: postId }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha ao excluir')
      load()
    } catch (e:any) {
      toast({ title: 'Erro ao excluir post', description: e?.message || 'Tente novamente', variant: 'destructive' })
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
      toast({ title: 'Conteúdo muito curto', description: 'Escreva ao menos 10 caracteres', variant: 'destructive' })
      return
    }
    try {
      const resp = await fetch('/api/ai?handler=suggest-hashtags', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text })
      })
      const json = await resp.json().catch(()=>({}))
      if (resp.ok && Array.isArray(json.hashtags) && json.hashtags.length > 0) {
        const proposal = json.hashtags.filter((h: string) => !text.includes(h))
        if (proposal.length > 0) {
          const add = confirm(`Sugerir # para este post editado?\n${proposal.join(' ')}\n\nAdicionar?`)
          if (add) {
            text = `${text}\n${proposal.join(' ')}`
            setEditingPostText(text)
          }
        }
      }
    } catch {}
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      if (!token) throw new Error('Não autenticado')
      const resp = await fetch('/api/forum?handler=moderate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action:'update_post', post_id: post.id, content_md: text })
      })
      const j = await resp.json().catch(()=>({}))
      if (!resp.ok) throw new Error(j?.error || 'Falha ao salvar edição')
      cancelEditPost()
      load()
      toast({ title: 'Post atualizado' })
    } catch (e:any) {
      toast({ title: 'Erro ao salvar edição', description: e?.message || 'Tente novamente', variant: 'destructive' })
    }
  }

  const handleCleanExistingPost = async (post: Post) => {
    setCleaningPostId(post.id)
    try {
      const resp = await fetch('/api/ai?handler=cleanup-text', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ title: topic?.title || '', description: post.content_md, language: localeToOpenAiLanguageTag(getActiveLocale()) })
      })
      const j = await resp.json().catch(()=>({}))
      const cleaned = j?.cleaned?.description
      if (!resp.ok || !cleaned) throw new Error(j?.error || 'Falha na revisão automática')

      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      if (!token) throw new Error('Não autenticado')
      const save = await fetch('/api/forum?handler=moderate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action:'update_post', post_id: post.id, content_md: cleaned })
      })
      const j2 = await save.json().catch(()=>({}))
      if (!save.ok) throw new Error(j2?.error || 'Erro ao salvar revisão')

      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, content_md: cleaned } : p))
      toast({ title: 'Texto revisado', description: 'Ortografia e pontuação ajustadas (sem mudar conteúdo).' })
    } catch (e:any) {
      toast({ title: 'Erro ao revisar', description: e?.message || 'Tente novamente', variant: 'destructive' })
    } finally {
      setCleaningPostId(null)
    }
  }

  const handleDeleteTopic = async () => {
    if (!id) return
    if (!confirm('Excluir este tópico e todos os posts?')) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'delete_topic', topic_id: id }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha ao excluir')
      toast({ title: 'Tópico excluído' })
      window.history.back()
    } catch (e:any) {
      toast({ title: 'Erro ao excluir tópico', description: e?.message || 'Tente novamente', variant: 'destructive' })
    }
  }

  const handleClearTopic = async () => {
    if (!id) return
    if (!confirm('Remover todos os posts deste tópico?')) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'clear_topic', topic_id: id }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha ao limpar')
      toast({ title: 'Tópico limpo' })
      load()
    } catch (e:any) {
      toast({ title: 'Erro ao limpar tópico', description: e?.message || 'Tente novamente', variant: 'destructive' })
    }
  }

  const handleUpdateTopic = async () => {
    if (!id) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum?handler=moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'update_topic', topic_id: id, update: { title: editTitle, description: editDesc } }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha ao atualizar')
      setEditing(false)
      load()
    } catch (e:any) {
      toast({ title: 'Erro ao atualizar tópico', description: e?.message || 'Tente novamente', variant: 'destructive' })
    }
  }

  if (!topic) return null

  const topicTitle = translatedTopic.title || topic.title
  const topicDescription = translatedTopic.description ?? topic.description ?? ''
  const summaryText = translatedSummary || compendium?.summary_md || ''

  return (
    <div className="relative min-h-screen pb-40">
      <ThemedBackground theme="atitude" />
      <HelpInfo kind="forum" />
      <div className="container relative mx-auto p-4 md:p-6 max-w-5xl space-y-4">
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="space-y-2 md:max-w-xl">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/forums')}
                  className="-ml-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Voltar aos fóruns
                </Button>
                {editing ? (
                  <div className="space-y-3 rounded-2xl border border-white/10 bg-black/35 p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>Revise título e descrição com IA (somente ortografia e pontuação, sem mudar o conteúdo).</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={async () => {
                          const textTitle = editTitle.trim()
                          const textDesc = editDesc.trim()
                          if (!textTitle && !textDesc) return
                          try {
                            const resp = await fetch('/api/ai?handler=cleanup-text', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ title: textTitle, description: textDesc, language: localeToOpenAiLanguageTag(getActiveLocale()) })
                            })
                            const j = await resp.json().catch(() => ({}))
                            if (!resp.ok || !j?.cleaned) throw new Error(j?.error || 'Falha na revisão')
                            if (typeof j.cleaned.title === 'string' && j.cleaned.title.trim()) {
                              setEditTitle(j.cleaned.title)
                            }
                            if (typeof j.cleaned.description === 'string' && j.cleaned.description.trim()) {
                              setEditDesc(j.cleaned.description)
                            }
                          } catch (e:any) {
                            toast({ title: 'Erro na revisão automática', description: e?.message || 'Tente novamente', variant: 'destructive' })
                          }
                        }}
                        title="Revisar ortografia e pontuação do tópico"
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
                      <Button size="sm" onClick={handleUpdateTopic}>Salvar</Button>
                      <Button size="sm" variant="outline" onClick={()=>{ setEditing(false); }}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <CardTitle className="text-2xl font-bold break-words">{topicTitle}</CardTitle>
                    <CardDescription className="whitespace-pre-line">{topicDescription}</CardDescription>
                    {isTranslating && (
                      <p className="text-[11px] text-muted-foreground">
                        Gerando traduções para inglês e mandarim...
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 w-full md:w-auto">
                <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
                  <Badge variant={topic.status === 'closed' ? 'secondary' : 'default'}>
                    {topic.status}
                  </Badge>
                  <span className="text-muted-foreground text-right max-w-xs">
                    {permissionLabel}
                  </span>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => navigate(`/forums/insights?topic_id=${encodeURIComponent(id || '')}`)}
                    disabled={!id}
                    className="text-[11px]"
                  >
                    Top Temas & Ações
                  </Button>
                  {id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(id)}`)
                        openWhatsAppShare({
                          message: `Veja este fórum no DJT Quest:\n${topicTitle}`,
                          url,
                        })
                      }}
                      title="Compartilhar este fórum no WhatsApp"
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
                      title="Ouvir este fórum"
                      aria-label="Ouvir este fórum"
                    >
                      <Volume2 className="h-4 w-4" />
                    </Button>
                  )}
                  {isLeaderMod && topic.status !== 'closed' && (
                    <Button size="xs" onClick={handleClose} className="text-[11px]">
                      Fechar & Curar
                    </Button>
                  )}
                  {isLeaderMod && !editing && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setEditing(true)
                        setEditTitle(topic.title)
                        setEditDesc(topic.description || '')
                      }}
                      className="text-[11px]"
                    >
                      Editar
                    </Button>
                  )}
                  {isLeaderMod && (
                    <>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={handleClearTopic}
                        className="text-[11px]"
                      >
                        Limpar
                      </Button>
                      {canDeleteTopic && (
                        <Button
                          size="xs"
                          variant="destructive"
                          onClick={handleDeleteTopic}
                          className="text-[11px]"
                        >
                          Excluir
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
              <CardTitle className="text-xl">Compêndio do Tema</CardTitle>
              <CardDescription>
                Resumo e aprendizados curados para reuso em quizzes, desafios e campanhas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {summaryText && (
                <div className="text-sm whitespace-pre-wrap">{String(summaryText)}</div>
              )}

              {Array.isArray(compendium?.key_learnings) && compendium.key_learnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Aprendizados-chave</p>
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
                    <p className="text-sm font-semibold">Anexos do tema</p>
                    <AttachmentViewer urls={all} />
                  </div>
                )
              })()}

              {isLeaderMod && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => sendCompendiumToStudio('quiz')}>
                    Criar Quiz (Studio)
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sendCompendiumToStudio('desafio')}>
                    Criar Desafio (Studio)
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sendCompendiumToStudio('campanha')}>
                    Criar Campanha (Studio)
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
              const authorLabel = (() => {
                const sigla = p.author?.sigla_area || ''
                const name = p.author?.name || ''
                if (sigla && name) return `[${sigla}] ${name}`
                if (sigla) return `[${sigla}]`
                return name || 'Colaborador'
              })()
              return (
            <Card key={p.id} id={`post-${p.id}`}>
              <CardContent className="p-4 space-y-2">
                {editingPostId === p.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Use a varinha para ajustar ortografia e pontuação deste relato.</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={async () => {
                          const source = (editingPostText || '').trim()
                          if (source.length < 3) return
                          try {
                            const resp = await fetch('/api/ai?handler=cleanup-text', {
                              method:'POST',
                              headers:{ 'Content-Type':'application/json' },
                              body: JSON.stringify({ title: topic?.title || '', description: source, language: localeToOpenAiLanguageTag(getActiveLocale()) })
                            })
                            const j = await resp.json().catch(()=>({}))
                            const cleaned = j?.cleaned?.description
                            if (!resp.ok || !cleaned) throw new Error(j?.error || 'Falha na revisão automática')
                            setEditingPostText(String(cleaned))
                          } catch (e:any) {
                            toast({ title:'Erro na revisão', description: e?.message || 'Tente novamente', variant:'destructive' })
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
                      <Button size="sm" variant="outline" onClick={cancelEditPost}>Cancelar</Button>
                      <Button size="sm" onClick={()=>handleSavePostEdit(p)}>Salvar</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <p className="text-[11px] font-semibold text-primary">
                        {authorLabel}
                      </p>
                      <div className="text-sm whitespace-pre-wrap">{postText}</div>
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          const url = buildAbsoluteAppUrl(
                            `/forum/${encodeURIComponent(id || '')}#post-${encodeURIComponent(p.id)}`,
                          )
                          const preview = (postText || '').trim().replace(/\s+/g, ' ').slice(0, 160)
                          openWhatsAppShare({
                            message: `Comentário no fórum:\n${topicTitle}\n"${preview}${preview.length >= 160 ? '…' : ''}"`,
                            url,
                          })
                        }}
                        title="Compartilhar este comentário no WhatsApp"
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={isSpeaking}
                        onClick={() => speakText(postText)}
                        title="Ouvir este comentário"
                        aria-label="Ouvir este comentário"
                      >
                        <Volume2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setReplyToPostId(p.id)
                          setReplyToExcerpt(postText.slice(0, 140))
                        }}
                      >
                        ↳ Responder
                      </Button>
                      {(isLeaderMod || p.user_id === user?.id) && (
                        <>
                          <Button size="xs" variant="outline" onClick={()=>startEditPost(p)}>Editar</Button>
                          <Button size="xs" variant="destructive" onClick={()=>handleDeletePost(p.id)}>Excluir</Button>
                        </>
                      )}
                      {isLeaderMod && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => handleCleanExistingPost(p)}
                          disabled={cleaningPostId === p.id}
                        >
                          <Wand2 className="h-4 w-4 mr-1" />
                          Revisar IA
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {(() => {
                  const urls =
                    ((p as any)?.payload?.attachments ||
                      (p as any)?.payload?.images ||
                      (p as any)?.attachment_urls) as string[] | undefined;
                  if (!Array.isArray(urls) || urls.length === 0) return null;
                  return <AttachmentViewer urls={urls} postId={p.id} />;
                })()}
                {p.ai_assessment && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Qualidade: {(p.ai_assessment.helpfulness ?? 0).toFixed(2)} / {(p.ai_assessment.clarity ?? 0).toFixed(2)} / {(p.ai_assessment.novelty ?? 0).toFixed(2)}
                  </div>
                )}
                {replies.length > 0 && (
                  <div className="mt-3 space-y-2 border-l border-border/40 pl-3">
                    {replies.map((r) => {
                      const replyText = translatedPosts[r.id] || postLocalTranslations[r.id] || r.content_md
                      const rAuthorLabel = (() => {
                        const sigla = r.author?.sigla_area || ''
                        const name = r.author?.name || ''
                        if (sigla && name) return `[${sigla}] ${name}`
                        if (sigla) return `[${sigla}]`
                        return name || 'Colaborador'
                      })()
                      return (
                      <div key={r.id} id={`post-${r.id}`} className="flex items-start justify-between gap-2 text-sm text-muted-foreground">
                        <div className="whitespace-pre-wrap flex-1 space-y-1">
                          <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                            <span className="text-xs">↳ resposta</span>
                            <span>{rAuthorLabel}</span>
                          </p>
                          <div>{replyText}</div>
                          {(() => {
                            const urls =
                              ((r as any)?.payload?.attachments ||
                                (r as any)?.payload?.images ||
                                (r as any)?.attachment_urls) as string[] | undefined;
                            if (!Array.isArray(urls) || urls.length === 0) return null;
                            return <AttachmentViewer urls={urls} postId={r.id} />;
                          })()}
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              const url = buildAbsoluteAppUrl(
                                `/forum/${encodeURIComponent(id || '')}#post-${encodeURIComponent(r.id)}`,
                              )
                              const preview = (replyText || '').trim().replace(/\s+/g, ' ').slice(0, 160)
                              openWhatsAppShare({
                                message: `Comentário no fórum:\n${topicTitle}\n"${preview}${preview.length >= 160 ? '…' : ''}"`,
                                url,
                              })
                            }}
                            title="Compartilhar este comentário no WhatsApp"
                          >
                            <Share2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={isSpeaking}
                            onClick={() => speakText(replyText)}
                            title="Ouvir esta resposta"
                            aria-label="Ouvir esta resposta"
                          >
                            <Volume2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              setReplyToPostId(r.id)
                              setReplyToExcerpt(replyText.slice(0, 140))
                            }}
                          >
                            ↳ Responder
                          </Button>
                          {(isLeaderMod || r.user_id === user?.id) && (
                            <>
                              <Button size="xs" variant="outline" onClick={()=>startEditPost(r)}>Editar</Button>
                              <Button size="xs" variant="destructive" onClick={()=>handleDeletePost(r.id)}>Excluir</Button>
                            </>
                          )}
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
              <CardTitle>Nova contribuição</CardTitle>
              <CardDescription>Traga seu relato completo: marque colegas com @, assuntos com # e suba evidências para deixar o aprendizado vivo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    {replyToPostId
                      ? 'Respondendo a um comentário deste fórum. Sua resposta ficará encadeada logo abaixo do comentário original.'
                      : 'Descreva o contexto com suas palavras. Use a varinha para ajustar ortografia e pontuação.'}
                  </p>
                  {replyToPostId && (
                    <div className="text-[11px] text-muted-foreground border border-dashed border-border/60 rounded px-2 py-1 flex items-start justify-between gap-2">
                      <span className="truncate">
                        <span className="font-semibold mr-1">Comentário alvo:</span>
                        {replyToExcerpt || '...'}
                      </span>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setReplyToPostId(null)
                          setReplyToExcerpt('')
                        }}
                      >
                        Cancelar resposta
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
                  title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea rows={4} value={content} onChange={(e)=>handleContentChange(e.target.value)} placeholder="Contexto, ação e resultado em poucas linhas..." />
              {mentionSuggestions.length > 0 && mentionQuery.trim().length >= 1 && (
                <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  {mentionSuggestions.map((s, idx) => (
                    <button
                      key={`${s.kind}-${s.handle}-${idx}`}
                      type="button"
                      onClick={() => {
                        setContent(prev => {
                          const re = /@([A-Za-z0-9_.-]{1,30})/g
                          const all = Array.from(prev.matchAll(re))
                          if (!all.length) {
                            return [prev.trim(), `@${s.handle}`].filter(Boolean).join(' ')
                          }
                          const last = all[all.length - 1]
                          const start = last.index ?? 0
                          const before = prev.slice(0, start)
                          const after = prev.slice(start + last[0].length)
                          return `${before}@${s.handle}${after}`
                        })
                        setMentionQuery('')
                        setMentionSuggestions([])
                      }}
                      className="px-2 py-0.5 rounded-full border border-muted-foreground/40 bg-background/60 hover:bg-muted"
                    >
                      <span className="font-semibold">
                        {s.label || s.handle}
                      </span>
                      {s.kind === 'user' && (
                        <span className="ml-1 opacity-70">@{s.handle}</span>
                      )}
                      {s.kind === 'team' && (
                        <span className="ml-1 opacity-70">(equipe @{s.handle})</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Anexos (opcional)</p>
                  <AttachmentUploader
                    onAttachmentsChange={setAttachmentUrls}
                    onUploadingChange={setAttachmentsUploading}
                    maxFiles={6}
                    maxSizeMB={50}
                    capture="environment"
                    maxVideoSeconds={90}
                  />
                  {attachmentsUploading && (
                    <p className="text-[11px] text-muted-foreground">Aguarde: enviando anexos…</p>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Áudio para organizar com IA (opcional)</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <VoiceRecorderButton
                        size="sm"
                        label="Gravar áudio"
                        onText={(text) => setContent(prev => [prev, text].filter(Boolean).join('\n\n'))}
                      />
                      <Input type="file" accept="audio/*" onChange={(e)=>setAudioFile(e.target.files?.[0] || null)} className="sm:max-w-[360px]" />
                      {audioFile && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setAudioFile(null)}>
                          Remover áudio
                        </Button>
                      )}
                      <Button variant="outline" disabled={!audioFile || transcribing} onClick={handleTranscribe}>
                        {transcribing ? 'Transcrevendo...' : 'Organizar áudio'}
                      </Button>
                    </div>
                    {audioPreviewUrl && (
                      <audio controls src={audioPreviewUrl} className="w-full" />
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Dica: prefira gravações curtas para transcrição rápida e com menos ruído.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handlePost} disabled={!content.trim() || attachmentsUploading}>Publicar</Button>
              </div>
            </CardContent>
          </Card>
        )}
              </div>
              <Navigation />
            </div>
  )
}
