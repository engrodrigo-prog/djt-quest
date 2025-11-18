import { useEffect, useState, useCallback } from 'react'
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
import { AttachmentMetadataModal } from '@/components/AttachmentMetadataModal'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import Navigation from '@/components/Navigation'
import { Wand2 } from 'lucide-react'

interface Topic { id: string; title: string; description: string | null; status: string; chas_dimension: 'C'|'H'|'A'|'S'; quiz_specialties: string[] | null; tags: string[] | null }
interface Post {
  id: string;
  user_id: string;
  content_md: string;
  payload: any;
  created_at: string;
  ai_assessment: any;
  parent_post_id?: string | null;
  reply_to_user_id?: string | null;
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
  const [topic, setTopic] = useState<Topic | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [content, setContent] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [metaUrl, setMetaUrl] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
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

  const load = useCallback(async () => {
    if (!id) return
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from('forum_topics').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('forum_posts')
        .select('id,user_id,content_md,payload,created_at,ai_assessment,parent_post_id,reply_to_user_id,author:profiles!forum_posts_author_id_fkey(name,sigla_area)')
        .eq('topic_id', id)
        .order('created_at', { ascending: true }),
    ])
    setTopic(t as any)
    setPosts((p || []) as any)
  }, [id])

  useEffect(() => { load() }, [load])

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

  const handleTranscribe = async () => {
    if (!audioFile) return
    try {
      setTranscribing(true)
      const toBase64 = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(f) })
      const b64 = await toBase64(audioFile)
      const resp = await fetch('/api/ai?handler=transcribe-audio', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ audioBase64: b64, mode:'organize', language:'pt' }) })
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
        body: JSON.stringify({ title: topic?.title || '', description: text, language: 'pt-BR' })
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
            payload: { images: imageUrls },
            attachment_urls: imageUrls,
            parent_post_id: replyToPostId || null,
            ...(parent?.user_id ? { reply_to_user_id: parent.user_id } : {}),
          })
        })
        const j = await resp.json().catch(()=>({}))
        if (!resp.ok) throw new Error(j?.error || 'Falha ao publicar')
        setContent('')
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
              payload: { images: imageUrls },
              parent_post_id: replyToPostId || null,
              ...(parent?.user_id ? { reply_to_user_id: parent.user_id } : {}),
            })
          if (insErr) throw new Error(insErr.message)
          setContent('')
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
        body: JSON.stringify({ title: topic?.title || '', description: post.content_md, language: 'pt-BR' })
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
                              body: JSON.stringify({ title: textTitle, description: textDesc, language: 'pt-BR' })
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
                    <CardTitle className="text-2xl font-bold break-words">{topic.title}</CardTitle>
                    <CardDescription className="whitespace-pre-line">{topic.description}</CardDescription>
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
                      size="xs"
                      variant="outline"
                      className="text-[11px]"
                      onClick={() => {
                        try {
                          const base = window.location.origin;
                          const url = `${base}/forums/${encodeURIComponent(id)}`;
                          const text = `Veja este fórum no DJT Quest:\n${topic.title}\n${url}`;
                          const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
                          window.open(waUrl, '_blank', 'noopener,noreferrer');
                        } catch {
                          // silencioso
                        }
                      }}
                    >
                      Compartilhar no WhatsApp
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

        <div className="space-y-3">
          {posts
            .filter((p) => !p.parent_post_id)
            .map((p) => {
              const replies = posts.filter((r) => r.parent_post_id === p.id)
              const authorLabel = (() => {
                const sigla = p.author?.sigla_area || ''
                const name = p.author?.name || ''
                if (sigla && name) return `[${sigla}] ${name}`
                if (sigla) return `[${sigla}]`
                return name || 'Colaborador'
              })()
              return (
            <Card key={p.id}>
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
                              body: JSON.stringify({ title: topic?.title || '', description: source, language:'pt-BR' })
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
                      <div className="text-sm whitespace-pre-wrap">{p.content_md}</div>
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setReplyToPostId(p.id)
                          setReplyToExcerpt(p.content_md.slice(0, 140))
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
                {/* Render image attachments if present */}
                    {((p as any)?.payload?.images?.length || (p as any)?.attachment_urls?.length) && (
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        {(((p as any)?.payload?.images || (p as any)?.attachment_urls) as string[]).map((url, idx) => (
                          <div key={idx} className="space-y-2">
                            <img
                              src={url}
                              alt="anexo"
                              className="w-full h-28 object-cover rounded cursor-pointer hover:opacity-90"
                              onClick={()=>setLightboxUrl(url)}
                            />
                            <div className="flex gap-2 text-[11px] text-muted-foreground">
                              <button
                                type="button"
                                className="px-2 py-1 rounded-lg border border-white/10 hover:bg-white/5"
                                onClick={()=>setLightboxUrl(url)}
                              >
                                Ver
                              </button>
                              <button
                                type="button"
                                className="px-2 py-1 rounded-lg border border-white/10 hover:bg-white/5"
                                onClick={()=>window.open(url, '_blank')}
                              >
                                Baixar
                              </button>
                              <button
                                type="button"
                                className="px-2 py-1 rounded-lg border border-white/10 hover:bg-white/5"
                                onClick={()=>setMetaUrl(url)}
                              >
                                Metadados
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                {p.ai_assessment && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Qualidade: {(p.ai_assessment.helpfulness ?? 0).toFixed(2)} / {(p.ai_assessment.clarity ?? 0).toFixed(2)} / {(p.ai_assessment.novelty ?? 0).toFixed(2)}
                  </div>
                )}
                {replies.length > 0 && (
                  <div className="mt-3 space-y-2 border-l border-border/40 pl-3">
                    {replies.map((r) => {
                      const rAuthorLabel = (() => {
                        const sigla = r.author?.sigla_area || ''
                        const name = r.author?.name || ''
                        if (sigla && name) return `[${sigla}] ${name}`
                        if (sigla) return `[${sigla}]`
                        return name || 'Colaborador'
                      })()
                      return (
                      <div key={r.id} className="flex items-start justify-between gap-2 text-sm text-muted-foreground">
                        <div className="whitespace-pre-wrap flex-1 space-y-1">
                          <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                            <span className="text-xs">↳ resposta</span>
                            <span>{rAuthorLabel}</span>
                          </p>
                          <div>{r.content_md}</div>
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              setReplyToPostId(r.id)
                              setReplyToExcerpt(r.content_md.slice(0, 140))
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
                  <p className="text-sm text-muted-foreground">Evidências visuais (opcional)</p>
                  <AttachmentUploader onAttachmentsChange={setImageUrls} maxFiles={6} maxSizeMB={20} acceptMimeTypes={[ 'image/jpeg','image/png','image/webp','image/gif' ]} capture="environment" />
                  {imageUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {imageUrls.map((url) => (
                        <img key={url} src={url} alt="anexo" onClick={() => setMetaUrl(url)} className="h-16 w-16 object-cover rounded cursor-pointer hover:opacity-90" />
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Áudio para organizar com IA (opcional)</p>
                  <div className="flex items-center gap-3">
                    <Input type="file" accept="audio/*" onChange={(e)=>setAudioFile(e.target.files?.[0] || null)} />
                    <Button variant="outline" disabled={!audioFile || transcribing} onClick={handleTranscribe}>{transcribing ? 'Transcrevendo...' : 'Organizar áudio'}</Button>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handlePost} disabled={!content.trim()}>Publicar</Button>
              </div>
            </CardContent>
          </Card>
        )}

                  {metaUrl && (
                    <AttachmentMetadataModal url={metaUrl} open={!!metaUrl} onOpenChange={(o)=>!o && setMetaUrl(null)} />
                  )}
                  <Dialog open={!!lightboxUrl} onOpenChange={(o)=>{ if(!o) setLightboxUrl(null) }}>
                    <DialogContent className="max-w-3xl p-0 bg-black">
                      {lightboxUrl && (
                        <img src={lightboxUrl} alt="anexo" className="w-full h-full object-contain" />
                      )}
                    </DialogContent>
                  </Dialog>
              </div>
              <Navigation />
            </div>
  )
}
