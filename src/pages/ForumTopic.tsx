import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
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

interface Topic { id: string; title: string; description: string | null; status: string; chas_dimension: 'C'|'H'|'A'|'S'; quiz_specialties: string[] | null; tags: string[] | null }
interface Post { id: string; user_id: string; content_md: string; payload: any; created_at: string; ai_assessment: any }

export default function ForumTopic() {
  const { topicId: id } = useParams()
  const { toast } = useToast()
  const { isLeader, studioAccess, user } = useAuth()
  const [topic, setTopic] = useState<Topic | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [content, setContent] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [metaUrl, setMetaUrl] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from('forum_topics').select('*').eq('id', id).maybeSingle(),
      supabase.from('forum_posts').select('*').eq('topic_id', id).order('created_at', { ascending: true })
    ])
    setTopic(t as any)
    setPosts((p || []) as any)
  }, [id])

  useEffect(() => { load() }, [load])

  const handleTranscribe = async () => {
    if (!audioFile) return
    try {
      setTranscribing(true)
      const toBase64 = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(f) })
      const b64 = await toBase64(audioFile)
      const resp = await fetch('/api/transcribe-audio', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ audioBase64: b64, mode:'organize', language:'pt' }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha na transcrição')
      setContent(prev => [prev, j.text || j.transcript].filter(Boolean).join('\n\n'))
      toast({ title: 'Áudio organizado e inserido no post' })
    } catch (e: any) {
      toast({ title: 'Erro ao transcrever', description: e?.message || 'Tente novamente', variant: 'destructive' })
    } finally { setTranscribing(false) }
  }

  const handlePost = async () => {
    if (!id) return
    const text = (content || '').trim()
    if (text.length < 10) {
      toast({ title: 'Conteúdo muito curto', description: 'Escreva ao menos 10 caracteres', variant: 'destructive' })
      return
    }
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      // Try API route first (service role handles mentions/tagging uniformly)
      try {
        const resp = await fetch('/api/forum-post', {
          method:'POST', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ topic_id: id, content_md: text, payload: { images: imageUrls }, attachment_urls: imageUrls })
        })
        const j = await resp.json().catch(()=>({}))
        if (!resp.ok) throw new Error(j?.error || 'Falha ao publicar')
        setContent('')
        load()
        try { await fetch('/api/forum-ai-assess-post', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ post_id: (j as any)?.post?.id }) }) } catch {}
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
              payload: { images: imageUrls }
            })
          if (insErr) throw new Error(insErr.message)
          setContent('')
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
      const resp = await fetch('/api/forum-close-topic', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ topic_id: id }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha ao fechar')
      toast({ title: 'Tema fechado', description: 'Compêndio gerado.' })
      load()
    } catch (e: any) {
      toast({ title: 'Erro ao fechar', description: e?.message || 'Tente novamente', variant: 'destructive' })
    }
  }

  const isLeaderMod = Boolean(isLeader && studioAccess)

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Excluir este post definitivamente?')) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum-moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'delete_post', post_id: postId }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha ao excluir')
      load()
    } catch (e:any) {
      toast({ title: 'Erro ao excluir post', description: e?.message || 'Tente novamente', variant: 'destructive' })
    }
  }

  const handleDeleteTopic = async () => {
    if (!id) return
    if (!confirm('Excluir este tópico e todos os posts?')) return
    try {
      const { data: session } = await supabase.auth.getSession(); const token = session.session?.access_token
      const resp = await fetch('/api/forum-moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'delete_topic', topic_id: id }) })
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
      const resp = await fetch('/api/forum-moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'clear_topic', topic_id: id }) })
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
      const resp = await fetch('/api/forum-moderate', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'update_topic', topic_id: id, update: { title: editTitle, description: editDesc } }) })
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
            <div className="flex items-center justify-between">
              <div>
                {editing ? (
                  <div className="space-y-2">
                    <Input value={editTitle} onChange={(e)=>setEditTitle(e.target.value)} />
                    <Textarea rows={2} value={editDesc} onChange={(e)=>setEditDesc(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleUpdateTopic}>Salvar</Button>
                      <Button size="sm" variant="outline" onClick={()=>{ setEditing(false); }}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <CardTitle>{topic.title}</CardTitle>
                    <CardDescription>{topic.description}</CardDescription>
                  </>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <Badge variant={topic.status === 'closed' ? 'secondary' : 'default'}>{topic.status}</Badge>
                {isLeaderMod && topic.status !== 'closed' && (
                  <Button size="sm" onClick={handleClose}>Fechar & Curar</Button>
                )}
                {isLeaderMod && !editing && (
                  <Button size="sm" variant="outline" onClick={()=>{ setEditing(true); setEditTitle(topic.title); setEditDesc(topic.description || ''); }}>Editar</Button>
                )}
                {isLeaderMod && (
                  <>
                    <Button size="sm" variant="outline" onClick={handleClearTopic}>Limpar</Button>
                    <Button size="sm" variant="destructive" onClick={handleDeleteTopic}>Excluir</Button>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {topic.quiz_specialties?.map(s => (<Badge key={s} variant="outline">{s}</Badge>))}
              {topic.tags?.map(tag => (<Badge key={tag} className="bg-primary/10">#{tag}</Badge>))}
            </div>
          </CardHeader>
        </Card>

        <div className="space-y-3">
          {posts.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="text-sm whitespace-pre-wrap">{p.content_md}</div>
                {/* Render image attachments if present */}
                {((p as any)?.payload?.images?.length || (p as any)?.attachment_urls?.length) && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(((p as any)?.payload?.images || (p as any)?.attachment_urls) as string[]).map((url, idx) => (
                      <img key={idx} src={url} alt="anexo" className="w-full h-24 object-cover rounded cursor-pointer hover:opacity-90" onClick={()=>setMetaUrl(url)} />
                    ))}
                  </div>
                )}
                {p.ai_assessment && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Qualidade: {(p.ai_assessment.helpfulness ?? 0).toFixed(2)} / {(p.ai_assessment.clarity ?? 0).toFixed(2)} / {(p.ai_assessment.novelty ?? 0).toFixed(2)}
                  </div>
                )}
                {isLeaderMod && (
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" variant="destructive" onClick={()=>handleDeletePost(p.id)}>Excluir Post</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {topic.status !== 'closed' && (
          <Card>
            <CardHeader>
              <CardTitle>Nova contribuição</CardTitle>
              <CardDescription>Use @mencoes e #hashtags; anexar áudio e organizar com IA acelera registro.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={4} value={content} onChange={(e)=>setContent(e.target.value)} placeholder="Escreva sua contribuição..." />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Anexar fotos (opcional)</p>
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
                  <p className="text-sm text-muted-foreground">Anexar áudio (opcional)</p>
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
      </div>
    </div>
  )
}
