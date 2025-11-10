import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'

interface Challenge { id: string; title: string; type: string }
const WRONG_COUNT = 4;
const MIN_LENGTH = 5;

export const AiQuizGenerator = () => {
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<'basico'|'intermediario'|'avancado'|'especialista'>('basico')
  const [specialties, setSpecialties] = useState<string[]>([])
  const [context, setContext] = useState<string>('')
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [challengeId, setChallengeId] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [question, setQuestion] = useState('')
  const [correctText, setCorrectText] = useState('')
  const [correctExplanation, setCorrectExplanation] = useState('')
  const [wrongs, setWrongs] = useState<Array<{ text: string; explanation: string }>>(
    Array.from({ length: WRONG_COUNT }, () => ({ text: '', explanation: '' }))
  )

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('challenges')
        .select('id, title, type')
        .order('title')
        .limit(200)
      setChallenges(data || [])
    })()
  }, [])

  const generate = async () => {
    if (!topic.trim()) {
      toast('Informe um tema para gerar a questão.')
      return
    }
    setLoading(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const resp = await apiFetch('/api/ai-quiz-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ topic, difficulty, language: 'pt-BR' })
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json?.error || 'Falha na IA')

      setQuestion(json.draft.question || '')
      setCorrectText(json.draft.correct?.text || '')
      setCorrectExplanation(json.draft.correct?.explanation || '')
      const wrong = Array.isArray(json.draft.wrong) ? json.draft.wrong : []
      setWrongs(Array.from({ length: WRONG_COUNT }, (_, idx) => ({
        text: wrong[idx]?.text || '',
        explanation: wrong[idx]?.explanation || '',
      })))
      toast('Rascunho gerado com sucesso!')
    } catch (e: any) {
      toast(`Erro ao gerar: ${e?.message || e}`)
    } finally {
      setLoading(false)
    }
  }

  const generateWrongsOnly = async () => {
    if (question.trim().length < MIN_LENGTH || correctText.trim().length < MIN_LENGTH) {
      toast('Preencha a pergunta e a resposta correta antes de gerar alternativas erradas.')
      return
    }
    try {
      setLoading(true)
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const resp = await apiFetch('/api/ai-generate-wrongs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, correct: correctText, difficulty, specialties, context })
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json?.error || 'Falha ao gerar alternativas')
      const wrong = Array.isArray(json?.wrong) ? json.wrong : []
      setWrongs(Array.from({ length: WRONG_COUNT }, (_, idx) => ({
        text: wrong[idx]?.text || '',
        explanation: wrong[idx]?.explanation || '',
      })))
      toast('Alternativas erradas atualizadas!')
    } catch (error: any) {
      toast(`Erro: ${error?.message || error}`)
    } finally {
      setLoading(false)
    }
  }

  const validateFields = () => {
    if (question.trim().length < MIN_LENGTH) {
      toast('A pergunta deve ter pelo menos 5 caracteres.')
      return false
    }
    if (correctText.trim().length < MIN_LENGTH) {
      toast('A alternativa correta deve ter pelo menos 5 caracteres.')
      return false
    }
    if (wrongs.some((w, idx) => w.text.trim().length < MIN_LENGTH)) {
      toast('Cada alternativa errada deve ter pelo menos 5 caracteres.')
      return false
    }
    return true
  }

  const save = async () => {
    if (!challengeId) {
      toast('Selecione um desafio para salvar a pergunta.')
      return
    }
    if (!validateFields()) return
    setSaving(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const payload = {
        challengeId,
        question_text: question.trim(),
        difficulty_level: difficulty,
        options: [
          { option_text: correctText.trim(), is_correct: true, explanation: correctExplanation.trim() || null },
          ...wrongs.map((w) => ({ option_text: w.text.trim(), is_correct: false, explanation: (w.explanation || '').trim() || null }))
        ]
      }

      const resp = await apiFetch('/api/studio-create-quiz-question', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload)
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json?.error || 'Falha ao salvar')
      toast('Pergunta salva no desafio!')
      setQuestion('')
      setCorrectText('')
      setCorrectExplanation('')
      setWrongs(Array.from({ length: WRONG_COUNT }, () => ({ text: '', explanation: '' })))
    } catch (e: any) {
      toast(`Erro ao salvar: ${e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Gerar Pergunta de Quiz (IA)</CardTitle>
          <CardDescription>
            Informe um tema. A IA gera pergunta, alternativa correta e três alternativas erradas com explicações.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2 md:col-span-2">
              <Label>Tema</Label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ex.: NR10, subtransmissão, segurança, etc." />
            </div>
            <div className="space-y-2">
              <Label>Dificuldade</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
              <SelectItem value="basico">Básico</SelectItem>
              <SelectItem value="intermediario">Intermediário</SelectItem>
              <SelectItem value="avancado">Avançado</SelectItem>
              <SelectItem value="especialista">Especialista</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Especialidades (opcional)</Label>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[{id:'seguranca',label:'Segurança'},{id:'protecao_automacao',label:'Proteção & Automação'},{id:'telecom',label:'Telecom'},{id:'equipamentos_manobras',label:'Equipamentos & Manobras'},{id:'instrumentacao',label:'Instrumentação'},{id:'gerais',label:'Gerais'}].map(s => (
                  <label key={s.id} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={specialties.includes(s.id)} onChange={(e)=>setSpecialties(prev=> e.target.checked ? Array.from(new Set([...prev, s.id])) : prev.filter(x=>x!==s.id))} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Contexto (opcional)</Label>
              <Textarea rows={2} value={context} onChange={(e)=>setContext(e.target.value)} placeholder="Cenários, normas, restrições, etc." />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="game" onClick={generate} disabled={loading}>
              {loading ? 'Gerando pergunta...' : 'Gerar pergunta completa'}
            </Button>
            <Button variant="outline" onClick={generateWrongsOnly} disabled={loading}>
              {loading ? 'Gerando opções...' : 'Gerar alternativas erradas'}
            </Button>
          </div>

          {/* Editor do rascunho */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pergunta</Label>
              <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Alternativa correta</Label>
                <Input value={correctText} onChange={(e) => setCorrectText(e.target.value)} />
                <Textarea placeholder="Explicação (opcional)" value={correctExplanation} onChange={(e) => setCorrectExplanation(e.target.value)} rows={2} />
              </div>
              <div className="space-y-3">
                {wrongs.map((w, idx) => (
                  <div key={idx} className="space-y-1">
                    <Label>Alternativa errada {idx + 1}</Label>
                    <Input value={w.text} onChange={(e) => setWrongs((prev) => prev.map((x, i) => i === idx ? { ...x, text: e.target.value } : x))} />
                    <Textarea placeholder="Explicação (opcional)" value={w.explanation} onChange={(e) => setWrongs((prev) => prev.map((x, i) => i === idx ? { ...x, explanation: e.target.value } : x))} rows={2} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Salvar no desafio</Label>
              <Select value={challengeId} onValueChange={(v) => setChallengeId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o desafio" />
                </SelectTrigger>
                <SelectContent>
                  {challenges.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="game" className="w-full" onClick={save} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar pergunta no desafio'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
