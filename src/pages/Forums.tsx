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

interface Topic { id: string; title: string; description: string | null; status: string; chas_dimension: 'C'|'H'|'A'|'S'; quiz_specialties: string[] | null; tags: string[] | null; created_at: string }

export default function Forums() {
  const { isLeader, studioAccess } = useAuth()
  const nav = useNavigate()
  const [topics, setTopics] = useState<Topic[]>([])
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('forum_topics').select('*').order('created_at', { ascending: false }).limit(200)
    setTopics((data || []) as any)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = topics.filter(t => !q || t.title.toLowerCase().includes(q.toLowerCase()) || (t.tags||[]).some(tag => tag.includes(q.toLowerCase())))

  return (
    <div className="relative min-h-screen pb-40">
      <ThemedBackground theme="atitude" />
      <HelpInfo kind="forum" />
      <div className="container relative mx-auto p-4 md:p-6 max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Fóruns de Conhecimento</h1>
            <p className="text-muted-foreground">Temas curados por líderes; contribua com ideias, dúvidas e casos.</p>
          </div>
          {(isLeader && studioAccess) && (
            <Button onClick={() => nav('/studio')}>Criar Tema</Button>
          )}
        </div>
        <div className="flex gap-3 items-center">
          <Input placeholder="Buscar por título ou #tag" value={q} onChange={(e)=>setQ(e.target.value)} />
          <Button variant="outline" onClick={()=>nav('/forums/insights')}>Top Temas & Ações</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(t => (
            <Card key={t.id} className="cursor-pointer hover:-translate-y-1 transition" onClick={()=>nav(`/forum/${t.id}`)}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="truncate">{t.title}</CardTitle>
                  <Badge variant={t.status === 'closed' ? 'secondary' : 'default'}>{t.status}</Badge>
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
