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
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const resp = await fetch('/api/forum-post', { method:'POST', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ topic_id: id, content_md: content, payload: {} }) })
      const j = await resp.json(); if (!resp.ok) throw new Error(j?.error || 'Falha ao publicar')
      setContent('')
      load()
      // fire and forget AI assessment
      try { await fetch('/api/forum-ai-assess-post', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ post_id: j.post.id }) }) } catch {}
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
                <CardTitle>{topic.title}</CardTitle>
                <CardDescription>{topic.description}</CardDescription>
              </div>
              <div className="flex gap-2 items-center">
                <Badge variant={topic.status === 'closed' ? 'secondary' : 'default'}>{topic.status}</Badge>
                {isLeader && studioAccess && topic.status !== 'closed' && (
                  <Button size="sm" onClick={handleClose}>Fechar & Curar</Button>
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
                {p.ai_assessment && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Qualidade: {(p.ai_assessment.helpfulness ?? 0).toFixed(2)} / {(p.ai_assessment.clarity ?? 0).toFixed(2)} / {(p.ai_assessment.novelty ?? 0).toFixed(2)}
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
              <div className="flex items-center gap-3">
                <Input type="file" accept="audio/*" onChange={(e)=>setAudioFile(e.target.files?.[0] || null)} />
                <Button variant="outline" disabled={!audioFile || transcribing} onClick={handleTranscribe}>{transcribing ? 'Transcrevendo...' : 'Organizar áudio'}</Button>
                <Button onClick={handlePost} disabled={!content.trim()}>Publicar</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
