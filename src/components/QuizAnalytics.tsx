import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function QuizAnalytics({ challengeId }: { challengeId: string }) {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<{ totalAnswers: number; participants: number; perQuestion: Array<{ question: string; correctPct: number; total: number }> }>({ totalAnswers: 0, participants: 0, perQuestion: [] })

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const [{ data: questions }, { data: answers }] = await Promise.all([
          supabase.from('quiz_questions').select('id, question_text').eq('challenge_id', challengeId),
          supabase.from('user_quiz_answers').select('user_id, question_id, is_correct').eq('challenge_id', challengeId)
        ])
        const qMap = new Map<string, string>()
        ;(questions || []).forEach((q:any) => qMap.set(q.id, q.question_text))
        const perQ: Record<string, { total: number; correct: number }> = {}
        ;(answers || []).forEach((a:any) => {
          const k = a.question_id
          if (!perQ[k]) perQ[k] = { total: 0, correct: 0 }
          perQ[k].total += 1
          if (a.is_correct) perQ[k].correct += 1
        })
        const perQuestion = Object.entries(perQ).map(([qid, v]) => ({ question: qMap.get(qid) || 'Pergunta', total: v.total, correctPct: v.total > 0 ? Math.round((v.correct/v.total)*100) : 0 }))
        const participants = new Set((answers || []).map((a:any)=>a.user_id)).size
        const totalAnswers = (answers || []).length
        if (mounted) setSummary({ totalAnswers, participants, perQuestion })
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [challengeId])

  if (loading) return <Card><CardContent className="p-4">Carregando...</CardContent></Card>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico do Quiz</CardTitle>
        <CardDescription>Participação e taxa de acerto por pergunta</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-3 text-sm">
          <Badge variant="outline">Participantes: {summary.participants}</Badge>
          <Badge variant="outline">Respostas: {summary.totalAnswers}</Badge>
        </div>
        <div className="space-y-2">
          {summary.perQuestion.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sem respostas registradas.</div>
          ) : summary.perQuestion.map((row, i) => (
            <div key={i} className="flex items-center justify-between p-2 rounded border">
              <div className="pr-4 truncate">{row.question}</div>
              <Badge variant={row.correctPct >= 70 ? 'default' : row.correctPct >= 40 ? 'secondary' : 'destructive'}>{row.correctPct}%</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

