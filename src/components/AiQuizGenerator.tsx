import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { getActiveLocale } from '@/lib/i18n/activeLocale'
import { localeToOpenAiLanguageTag } from '@/lib/i18n/language'
import { ForumKbThemeSelector, type ForumKbSelection } from '@/components/ForumKbThemeSelector'

interface Challenge { id: string; title: string; type: string }
const WRONG_COUNT = 4;
const MIN_LENGTH = 5;
const MILHAO_TOTAL = 10;

type CatalogSource = {
  id: string;
  title: string;
  summary?: string | null;
  created_at?: string | null;
  last_used_at?: string | null;
  scope?: string | null;
  published?: boolean | null;
  ingest_status?: 'pending' | 'ok' | 'failed' | null;
};

type CompendiumItem = {
  id: string;
  updated_at?: string | null;
  source_path?: string | null;
  catalog?: any | null;
  final?: any | null;
};

const stringifyCompendiumToDataset = (it: CompendiumItem) => {
  const catalog = it?.catalog && typeof it.catalog === 'object' ? it.catalog : null;
  const kind = String((it?.final as any)?.kind || (it?.final as any)?.catalog?.kind || (it?.final as any)?.kind || '').trim();
  const title = String(catalog?.title || 'Item do Compêndio').trim() || 'Item do Compêndio';
  const summary = String(catalog?.summary || '').trim();
  const tags = Array.isArray(catalog?.tags) ? catalog.tags : Array.isArray(catalog?.keywords) ? catalog.keywords : [];
  const keyPoints = Array.isArray(catalog?.key_points) ? catalog.key_points : Array.isArray(catalog?.learning_points) ? catalog.learning_points : [];
  const suggested = Array.isArray(catalog?.suggested_quiz_topics) ? catalog.suggested_quiz_topics : [];

  const lines = [
    `Origem: Compêndio`,
    kind ? `Tipo: ${kind}` : null,
    `Título: ${title}`,
    summary ? `Resumo: ${summary}` : null,
    tags.length ? `Tags: ${tags.map((t: any) => String(t || '').trim()).filter(Boolean).slice(0, 20).join(', ')}` : null,
    keyPoints.length ? `Pontos-chave: ${keyPoints.map((t: any) => String(t || '').trim()).filter(Boolean).slice(0, 30).join(' | ')}` : null,
    suggested.length ? `Tópicos sugeridos: ${suggested.map((t: any) => String(t || '').trim()).filter(Boolean).slice(0, 20).join(' | ')}` : null,
    it?.source_path ? `Arquivo: ${String(it.source_path)}` : null,
  ].filter(Boolean);

  return {
    title,
    text: lines.join('\n'),
  };
};

const MILHAO_LEVELS = [
  { level: 1, xp: 100, faixa: 'Básico', titulo: 'Aquecimento I' },
  { level: 2, xp: 200, faixa: 'Básico', titulo: 'Aquecimento II' },
  { level: 3, xp: 300, faixa: 'Básico', titulo: 'Aquecimento III' },
  { level: 4, xp: 400, faixa: 'Intermediário', titulo: 'Desafio I' },
  { level: 5, xp: 500, faixa: 'Intermediário', titulo: 'Desafio II' },
  { level: 6, xp: 1000, faixa: 'Intermediário', titulo: 'Desafio III' },
  { level: 7, xp: 2000, faixa: 'Avançado', titulo: 'Avanço I' },
  { level: 8, xp: 3000, faixa: 'Avançado', titulo: 'Avanço II' },
  { level: 9, xp: 5000, faixa: 'Avançado', titulo: 'Avanço III' },
  { level: 10, xp: 10000, faixa: 'Sênior', titulo: 'Pergunta Máxima' },
] as const;

export const AiQuizGenerator = ({ defaultChallengeId }: { defaultChallengeId?: string }) => {
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<'basico'|'intermediario'|'avancado'|'especialista'>('basico')
  const [mode] = useState<'especial' | 'milzao'>('milzao')
  const [specialties, setSpecialties] = useState<string[]>([])
  const [context, setContext] = useState<string>('')
  const [rewardMode, setRewardMode] = useState<'fixed_xp' | 'tier_steps'>('fixed_xp')
  const [rewardTotalXp, setRewardTotalXp] = useState<number>(1000)
  const [rewardTierSteps, setRewardTierSteps] = useState<number>(1)
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
  const [fullQuiz, setFullQuiz] = useState<any | null>(null)
  const [manualSlots, setManualSlots] = useState<Record<number, boolean>>({})
  const [slotIndex, setSlotIndex] = useState<number>(1)
  const [studySources, setStudySources] = useState<CatalogSource[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [sourceUrls, setSourceUrls] = useState<string[]>([])
  const [webQuery, setWebQuery] = useState('')
  const [sourcePickerTab, setSourcePickerTab] = useState<'catalog' | 'compendium' | 'online'>('catalog')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogShowAll, setCatalogShowAll] = useState(false)
  const [compendiumItems, setCompendiumItems] = useState<CompendiumItem[]>([])
  const [compendiumQuery, setCompendiumQuery] = useState('')
  const [compendiumShowAll, setCompendiumShowAll] = useState(false)
  const [selectedCompendiumIds, setSelectedCompendiumIds] = useState<string[]>([])
  const [onlineUrlInput, setOnlineUrlInput] = useState('')
  const [datasetText, setDatasetText] = useState("")
  const [datasetTitle, setDatasetTitle] = useState("")
  const [kbEnabled, setKbEnabled] = useState(false)
  const [kbSelection, setKbSelection] = useState<ForumKbSelection | null>(null)
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)
  const generationTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (generationTimerRef.current) {
        window.clearInterval(generationTimerRef.current)
      }
    }
  }, [])

  const beginGeneration = (label: string) => {
    setIsGeneratingQuiz(true)
    setGenerationStatus(label)
    setGenerationProgress(5)
    if (generationTimerRef.current) {
      window.clearInterval(generationTimerRef.current)
    }
    generationTimerRef.current = window.setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev >= 90) return prev
        const inc = Math.max(1, Math.round(Math.random() * 4))
        return Math.min(90, prev + inc)
      })
    }, 650)
  }

  const setGenerationStage = (label: string, progress?: number) => {
    setGenerationStatus(label)
    if (typeof progress === 'number') {
      setGenerationProgress(() => Math.min(95, Math.max(0, progress)))
    }
  }

  const endGeneration = (ok: boolean) => {
    if (generationTimerRef.current) {
      window.clearInterval(generationTimerRef.current)
      generationTimerRef.current = null
    }
    setGenerationStatus(ok ? 'Quiz gerado!' : 'Falha ao gerar')
    setGenerationProgress(100)
    window.setTimeout(() => {
      setIsGeneratingQuiz(false)
      setGenerationStatus(null)
      setGenerationProgress(0)
    }, 900)
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('challenges')
        .select('id, title, type')
        .order('title')
        .limit(200)
      const list = data || []
      setChallenges(list)
      // Pré-selecionar desafio padrão (quando vier do Studio)
      if (defaultChallengeId && !challengeId && list.some((c: any) => c.id === defaultChallengeId)) {
        setChallengeId(defaultChallengeId)
      }
    })()
  }, [defaultChallengeId, challengeId])

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('study_sources')
          .select('id, title, summary, created_at, last_used_at, scope, published, ingest_status')
          .order('last_used_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(250)
        if (!error && Array.isArray(data)) setStudySources(data as any)
      } catch {
        // ignore on failure
      }
    })()
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession()
        const token = session.session?.access_token
        if (!token) return
        const resp = await apiFetch('/api/admin?handler=compendium-list', {
          method: 'GET',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          cache: 'no-store',
        })
        if (!resp.ok) return
        const json = await resp.json().catch(() => ({} as any))
        const items = Array.isArray(json?.items) ? json.items : []
        setCompendiumItems(items)
      } catch {
        // ignore
      }
    })()
  }, [])

  const normalizeText = (value: string) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  const RECENT_DAYS = 180
  const isRecentSource = (s: CatalogSource) => {
    const raw = s.last_used_at || s.created_at || ''
    const ts = Date.parse(String(raw))
    if (!Number.isFinite(ts)) return true
    return ts >= Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
  }

  const visibleCatalogSuggestions = (() => {
    const q = normalizeText(catalogQuery)
    const base = studySources
      .filter((s) => (catalogShowAll || q.length > 0 ? true : isRecentSource(s)))
      .filter((s) => {
        if (!q) return true
        const hay = normalizeText([s.title, s.summary].filter(Boolean).join(' '))
        return hay.includes(q)
      })
      .slice(0, 12)
    return base
  })()

  const isRecentCompendium = (it: CompendiumItem) => {
    const ts = Date.parse(String(it?.updated_at || ''))
    if (!Number.isFinite(ts)) return true
    return ts >= Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
  }

  const visibleCompendiumSuggestions = (() => {
    const q = normalizeText(compendiumQuery)
    const base = compendiumItems
      .filter((it) => (compendiumShowAll || q.length > 0 ? true : isRecentCompendium(it)))
      .filter((it) => {
        if (!q) return true
        const title = String(it?.catalog?.title || '')
        const summary = String(it?.catalog?.summary || '')
        const hay = normalizeText(`${title} ${summary}`)
        return hay.includes(q)
      })
      .slice(0, 12)
    return base
  })()

  const addCatalogSource = (id: string) => {
    const s = studySources.find((x) => x.id === id)
    if (!s) return
    if (selectedSourceIds.includes(id)) return
    if (s.ingest_status === 'failed' || s.ingest_status === 'pending') {
      toast('Esta fonte ainda não está pronta (falhou ou está em análise).')
      return
    }
    setSelectedSourceIds((prev) => [...prev, id])
    setCatalogQuery('')
  }

  const addCompendiumItem = (id: string) => {
    if (selectedCompendiumIds.includes(id)) return
    const it = compendiumItems.find((x) => x.id === id)
    if (!it) return
    setSelectedCompendiumIds((prev) => [...prev, id])
    setCompendiumQuery('')
  }

  const addOnlineUrl = () => {
    const raw = onlineUrlInput.trim()
    if (!raw) return
    let url: URL | null = null
    try {
      url = new URL(raw)
    } catch {
      toast('Cole uma URL válida (ex.: https://...)')
      return
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      toast('Apenas URLs http/https são suportadas.')
      return
    }
    const normalized = url.toString()
    setSourceUrls((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]))
    setOnlineUrlInput('')
  }

  const generate = async () => {
    if (!topic.trim()) {
      toast('Informe um tema para gerar a questão.')
      return
    }
    setLoading(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const resp = await apiFetch('/api/ai?handler=quiz-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ topic, difficulty, language: localeToOpenAiLanguageTag(getActiveLocale()) })
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

  const generateFullQuiz = async () => {
    const hasDataset = datasetText.trim().length > 0
    const hasSources = selectedSourceIds.length > 0
    const hasKb = Boolean(kbEnabled && kbSelection?.tags?.length)
    const hasCompendium = selectedCompendiumIds.length > 0
    const hasUrls = sourceUrls.length > 0
    const hasWebQuery = webQuery.trim().length > 0

    if (!topic.trim() && !context.trim() && !hasDataset && !hasSources && !hasKb && !hasCompendium && !hasUrls && !hasWebQuery) {
      toast('Informe ao menos um tema ou contexto (ou cole um dataset) para gerar o Quiz do Milhão.')
      return
    }
    if (!hasDataset && !hasSources && !hasKb && !hasCompendium && !hasUrls && !hasWebQuery) {
      toast.message('Gerando sem base de estudo', {
        description: 'As perguntas serão mais gerais. Para aderência máxima a normas/padrões internos, cole trechos ou selecione fontes.',
      })
    }
    setLoading(true)
    beginGeneration('Preparando fontes...')
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const handler = 'study-quiz'
      const instructions = [
        topic?.trim() ? `Tema: ${topic.trim()}` : '',
        specialties.length ? `Especialidades: ${specialties.join(', ')}` : '',
        context?.trim() ? `Contexto do usuário: ${context.trim()}` : '',
        'Regras: setor elétrico (CPFL/SEP/subtransmissão), foco em segurança e procedimentos. Se não houver material (normas/manuais) fornecido, não invente padrões internos; formule questões com base em boas práticas e princípios, e deixe enunciados claros e objetivos.',
      ]
        .filter(Boolean)
        .join('\n')
      const body = {
        mode: 'milhao',
        language: localeToOpenAiLanguageTag(getActiveLocale()),
        topic,
        context,
        specialties,
        instructions,
        source_ids: selectedSourceIds,
        source_urls: sourceUrls,
        ...(hasWebQuery ? { web_query: webQuery.trim() } : {}),
        ...(hasKb ? { kb_tags: kbSelection!.tags, kb_focus: kbSelection!.label } : {}),
        sources: [
          ...(hasDataset
            ? [{
                title: datasetTitle || topic || 'Base de estudo deste quiz',
                text: datasetText,
              }]
            : []),
          ...selectedCompendiumIds
            .map((id) => compendiumItems.find((x) => x.id === id) || null)
            .filter(Boolean)
            .map((it) => stringifyCompendiumToDataset(it as any)),
        ],
        question_count: MILHAO_TOTAL,
      }

      setGenerationStage('Gerando questões (IA)...', 25)
      const resp = await apiFetch(`/api/ai?handler=${handler}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json?.error || 'Falha ao gerar quiz completo')

      setGenerationStage('Processando e aplicando níveis...', 92)
      const sourceQuiz = json.quiz || json
      const incoming = Array.isArray(sourceQuiz.questoes)
        ? sourceQuiz.questoes
        : Array.isArray(sourceQuiz.questions)
        ? sourceQuiz.questions.map((q: any, idx: number) => ({
            id: idx + 1,
            nivel: idx + 1,
            enunciado: q.question_text,
            alternativas: q.options,
            correta: q.correct_letter,
            xp_base: q.xp_value,
          }))
        : []

      if (!incoming.length) {
        throw new Error('Resposta da IA em formato inesperado.')
      }

      const merged = Array.from({ length: MILHAO_TOTAL }, (_, idx) => {
      const manual = fullQuiz?.questoes?.[idx]
        if (manual && manualSlots[idx + 1]) {
          return manual
        }
        return incoming[idx] || manual || null
      }).filter(Boolean)

      setFullQuiz({
        ...(sourceQuiz || {}),
        tipo: 'milhao',
        questoes: merged,
      })

      if (datasetText.trim()) {
        const keep = window.confirm(
          'Quiz gerado com sucesso a partir deste dataset. Deseja guardar esse material como base de estudos para futuros quizzes?'
        )
        if (keep) {
          try {
            const { data: session2 } = await supabase.auth.getSession()
            const uid = session2.session?.user?.id
            if (uid) {
              const { error } = await supabase.from('study_sources').insert({
                user_id: uid,
                title: datasetTitle || topic || 'Base de estudo do Quiz do Milhão',
                kind: 'text',
                url: null,
                storage_path: null,
                summary: datasetText.slice(0, 500),
                full_text: datasetText,
                is_persistent: true,
              })
              if (error) {
                console.warn('AiQuizGenerator: falha ao salvar estudo', error.message)
              } else {
                toast('Dataset salvo na sua base de estudos.')
              }
            }
          } catch (e: any) {
            console.warn('AiQuizGenerator: erro ao salvar estudo', e?.message || e)
          }
        }
      }
      toast('Quiz completo (10 perguntas) gerado! Perguntas manuais foram mantidas e as demais preenchidas pela IA.')
      endGeneration(true)
    } catch (e: any) {
      toast(`Erro ao gerar quiz completo: ${e?.message || e}`)
      endGeneration(false)
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
      const resp = await apiFetch('/api/ai?handler=generate-wrongs', {
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

  const saveCurrentToSlot = () => {
    if (!question.trim() || !correctText.trim()) {
      toast('Preencha a pergunta e a alternativa correta antes de enviar para um slot.')
      return
    }
    const idx = Math.min(MILHAO_TOTAL, Math.max(1, slotIndex)) - 1
    const base = fullQuiz || { quiz_id: 'local-milhao', tipo: mode, criador: '', questoes: [] }
    const questoes = Array.from({ length: MILHAO_TOTAL }, (_, i) => base.questoes?.[i] || null)
    const cleanCorrect = correctText.trim()
    const wrongTexts = wrongs
      .map((w) => (w.text || '').trim())
      .filter((t) => t.length > 0 && t.toLowerCase() !== cleanCorrect.toLowerCase())

    const letters = ['A', 'B', 'C', 'D'] as const
    const shuffledLetters = [...letters].sort(() => Math.random() - 0.5)
    const correctIndex = Math.floor(Math.random() * shuffledLetters.length)
    const alternativas: Record<string, string> = {}

    alternativas[shuffledLetters[correctIndex]] = cleanCorrect

    let wi = 0
    for (let i = 0; i < shuffledLetters.length; i++) {
      if (i === correctIndex) continue
      const txt = wrongTexts[wi]
      if (!txt) break
      alternativas[shuffledLetters[i]] = txt
      wi++
    }

    // Se sobrar espaço e ainda houver textos, preenche slots remanescentes
    for (const extra of wrongTexts.slice(wi)) {
      const slot = letters.find((L) => !alternativas[L])
      if (!slot) break
      alternativas[slot] = extra
    }

    questoes[idx] = {
      id: idx + 1,
      nivel: idx + 1,
      enunciado: question.trim(),
      alternativas,
      correta: shuffledLetters[correctIndex],
      xp_base: base.questoes?.[idx]?.xp_base || undefined,
    }
    setFullQuiz({ ...base, questoes })
    setManualSlots((prev) => ({ ...prev, [idx + 1]: true }))
    toast(`Pergunta enviada para a posição ${idx + 1} do Quiz do Milhão.`)
  }

  const milhaoFilledCount = mode === 'milzao' && fullQuiz?.questoes
    ? fullQuiz.questoes.filter((q: any) => q && q.enunciado && String(q.enunciado).trim().length > 0).length
    : 0
  const milhaoProgress = mode === 'milzao'
    ? Math.min(100, Math.round((milhaoFilledCount / MILHAO_TOTAL) * 100))
    : 0

  const clampedSlotIndex = Math.min(MILHAO_TOTAL, Math.max(1, slotIndex))
  const currentMilhaoLevel = MILHAO_LEVELS[clampedSlotIndex - 1]

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

  const handlePublish = async () => {
    if (!fullQuiz || !Array.isArray(fullQuiz.questoes) || fullQuiz.questoes.length === 0) {
      toast('Gere o Quiz do Milhão completo antes de publicar.')
      return
    }
    const filled = fullQuiz.questoes.filter((q: any) => q && String(q.enunciado || '').trim().length > 0).length
    if (filled < MILHAO_TOTAL) {
      toast('Preencha as 10 posições do Quiz do Milhão antes de publicar.')
      return
    }
    if (rewardMode === 'fixed_xp') {
      const xp = Number(rewardTotalXp || 0)
      if (!Number.isFinite(xp) || xp < 100 || xp > 5000) {
        toast('Defina uma premiação total (XP) entre 100 e 5000.')
        return
      }
    }
    if (rewardMode === 'tier_steps') {
      const steps = Number(rewardTierSteps || 0)
      if (!Number.isFinite(steps) || steps < 1 || steps > 5) {
        toast('Defina a quantidade de patamares (1 a 5).')
        return
      }
    }
    try {
      setLoading(true)
      const resp = await apiFetch('/api/admin?handler=studio-publish-quiz-milhao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          quiz: fullQuiz,
          reward: {
            mode: rewardMode,
            total_xp: rewardMode === 'fixed_xp' ? Number(rewardTotalXp || 0) : undefined,
            tier_steps: rewardMode === 'tier_steps' ? Number(rewardTierSteps || 0) : undefined,
          },
        }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(json?.error || 'Falha ao publicar Quiz do Milhão')
      toast(`Quiz do Milhão publicado para todos: ${json?.title || ''}`)
    } catch (e: any) {
      toast(`Erro ao publicar Quiz do Milhão: ${e?.message || e}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Quiz Especial • Quiz do Milhão (IA)</CardTitle>
          <CardDescription>
            Informe um tema técnico. A IA pode gerar uma pergunta individual ou um quiz completo em 10 níveis crescentes,
            no formato clássico de 10 níveis (premiação em XP) para compor seu desafio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === 'milzao' && (
            <div className="space-y-2 mb-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{isGeneratingQuiz ? (generationStatus || 'Gerando Quiz do Milhão...') : 'Progresso do Quiz do Milhão (10 perguntas)'}</span>
                <span>{isGeneratingQuiz ? `${generationProgress}%` : `${milhaoProgress}%`}</span>
              </div>
              <Progress value={isGeneratingQuiz ? generationProgress : milhaoProgress} className="h-2" />
            </div>
          )}

          {mode === 'milzao' && (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="space-y-2">
                  <Label>Premiação do Quiz do Milhão</Label>
                  <Select value={rewardMode} onValueChange={(v) => setRewardMode(v as any)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed_xp">XP total (recomendado)</SelectItem>
                      <SelectItem value="tier_steps">Avançar patamares (badge)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {rewardMode === 'fixed_xp' ? (
                  <div className="space-y-2">
                    <Label>Total de XP (10 níveis)</Label>
                    <Input
                      type="number"
                      min={100}
                      max={5000}
                      value={rewardTotalXp}
                      onChange={(e) => setRewardTotalXp(Number(e.target.value) || 0)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      O XP é distribuído proporcionalmente pelo avanço (níveis 1→10) e encerra ao errar.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Patamares a avançar</Label>
                    <Input
                      type="number"
                      min={1}
                      max={5}
                      value={rewardTierSteps}
                      onChange={(e) => setRewardTierSteps(Number(e.target.value) || 1)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      O sistema calcula o XP necessário para avançar {rewardTierSteps} patamar(es) com base no tier atual do jogador no início da tentativa.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2 md:col-span-2">
              <Label>Tema</Label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ex.: NR10, subtransmissão, segurança, etc." />
            </div>
            <div className="space-y-2">
              <Label>Nível base para rascunhos (opcional)</Label>
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
          <div className="space-y-3">
            <Label>Datasets e bases de estudo</Label>
            <div className="space-y-2">
              <Textarea
                rows={3}
                value={datasetText}
                onChange={(e) => setDatasetText(e.target.value)}
                placeholder="Cole aqui trechos importantes do PDF, normas ou anotações que devem inspirar o Quiz do Milhão."
              />
              <Input
                className="mt-1"
                value={datasetTitle}
                onChange={(e) => setDatasetTitle(e.target.value)}
                placeholder="Título deste dataset (ex.: NR10 - Segurança em SEP)"
              />
              <p className="text-[11px] text-muted-foreground">
                Use o dataset rápido para trechos pontuais. Para bases maiores, use o StudyLab e selecione abaixo.
              </p>
            </div>

            <div className="space-y-3 rounded-md border border-border p-3 bg-muted/20">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Fontes (Catálogo, Compêndio e Online)</p>
                  <p className="text-[11px] text-muted-foreground">
                    Para manter a tela limpa, adicione fontes por busca/autocomplete. Por padrão aparecem só materiais recentes; use “Mostrar antigos” se precisar.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(selectedSourceIds.length + selectedCompendiumIds.length + sourceUrls.length) > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setSelectedSourceIds([])
                        setSelectedCompendiumIds([])
                        setSourceUrls([])
                      }}
                    >
                      Limpar ({selectedSourceIds.length + selectedCompendiumIds.length + sourceUrls.length})
                    </Button>
                  )}
                </div>
              </div>

              {(selectedSourceIds.length + selectedCompendiumIds.length + sourceUrls.length) > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedSourceIds.map((id) => {
                    const s = studySources.find((x) => x.id === id)
                    const label = s?.title || id
                    return (
                      <Button key={id} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSelectedSourceIds((prev) => prev.filter((x) => x !== id))}>
                        {label} ✕
                      </Button>
                    )
                  })}
                  {selectedCompendiumIds.map((id) => {
                    const it = compendiumItems.find((x) => x.id === id)
                    const label = String(it?.catalog?.title || 'Compêndio')
                    return (
                      <Button key={id} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSelectedCompendiumIds((prev) => prev.filter((x) => x !== id))}>
                        {label} ✕
                      </Button>
                    )
                  })}
                  {sourceUrls.map((u) => (
                    <Button key={u} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSourceUrls((prev) => prev.filter((x) => x !== u))}>
                      {u.replace(/^https?:\/\//, '').slice(0, 32)}… ✕
                    </Button>
                  ))}
                </div>
              )}

              <Tabs value={sourcePickerTab} onValueChange={(v) => setSourcePickerTab(v as any)}>
                <TabsList className="w-full">
                  <TabsTrigger value="catalog" className="flex-1">
                    Catálogo
                  </TabsTrigger>
                  <TabsTrigger value="compendium" className="flex-1">
                    Compêndio
                  </TabsTrigger>
                  <TabsTrigger value="online" className="flex-1">
                    Online
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="catalog" className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-muted-foreground">Busca no StudyLab (catálogo). Clique em “Adicionar”.</p>
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-muted-foreground">Mostrar antigos</p>
                      <Switch checked={catalogShowAll} onCheckedChange={setCatalogShowAll} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Ex.: NR10, relé, proteção, telecom…" />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {visibleCatalogSuggestions.map((s) => (
                      <div key={s.id} className="rounded-md border px-3 py-2 bg-background flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium line-clamp-2">{s.title}</p>
                          {s.summary && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{s.summary}</p>}
                        </div>
                        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => addCatalogSource(s.id)} disabled={selectedSourceIds.includes(s.id) || s.ingest_status !== 'ok'}>
                          Adicionar
                        </Button>
                      </div>
                    ))}
                    {visibleCatalogSuggestions.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nenhuma fonte encontrada. Cadastre materiais no StudyLab ou ajuste a busca.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="compendium" className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-muted-foreground">Busca no Compêndio (itens FINAL_APPROVED). Clique em “Adicionar”.</p>
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-muted-foreground">Mostrar antigos</p>
                      <Switch checked={compendiumShowAll} onCheckedChange={setCompendiumShowAll} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input value={compendiumQuery} onChange={(e) => setCompendiumQuery(e.target.value)} placeholder="Ex.: ocorrência, disjuntor, telecom, procedimento…" />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {visibleCompendiumSuggestions.map((it) => (
                      <div key={it.id} className="rounded-md border px-3 py-2 bg-background flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium line-clamp-2">{String(it?.catalog?.title || 'Item do Compêndio')}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{String(it?.catalog?.summary || '').trim() || 'Sem resumo'}</p>
                        </div>
                        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => addCompendiumItem(it.id)} disabled={selectedCompendiumIds.includes(it.id)}>
                          Adicionar
                        </Button>
                      </div>
                    ))}
                    {visibleCompendiumSuggestions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Sem itens disponíveis (ou sem permissão). Se precisar, valide acesso ao módulo Compêndio no Studio.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="online" className="space-y-3">
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      URL: o backend lê o texto (leve) e usa como contexto do quiz. Busca web: gera um resumo com fontes para usar como dataset.
                    </p>
                    <div className="flex gap-2">
                      <Input value={onlineUrlInput} onChange={(e) => setOnlineUrlInput(e.target.value)} placeholder="Cole uma URL (https://...)" />
                      <Button type="button" variant="outline" onClick={addOnlineUrl}>
                        Adicionar URL
                      </Button>
                    </div>
                  </div>
                  {sourceUrls.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">{sourceUrls.length} URL(s) adicionada(s).</p>
                  )}
                  <div className="space-y-2">
                    <Label>Busca web (opcional)</Label>
                    <Input value={webQuery} onChange={(e) => setWebQuery(e.target.value)} placeholder="Ex.: 'procedimento de manobra em disjuntor 7SJ62 proteção'…" />
                    <p className="text-[11px] text-muted-foreground">
                      Use quando não houver documento interno. A IA vai usar um resumo curto da web (sem inventar padrões internos).
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-3 rounded-md border border-border p-3 bg-muted/20">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Base de conhecimento por hashtags (Fórum + StudyLab)</p>
                  <p className="text-[11px] text-muted-foreground">
                    Selecione temas/subtemas já usados na base de conhecimento para puxar trechos relevantes como fonte adicional do quiz.
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Usar</p>
                  <Switch
                    checked={kbEnabled}
                    onCheckedChange={(v) => {
                      setKbEnabled(v);
                      if (!v) setKbSelection(null);
                    }}
                  />
                </div>
              </div>

              {kbEnabled ? (
                <ForumKbThemeSelector maxTags={20} onChange={setKbSelection} />
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Ative para selecionar um tema e incluir o contexto da base de conhecimento na geração.
                </p>
              )}
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
            <Button variant="outline" onClick={generateFullQuiz} disabled={loading}>
              {loading ? 'Gerando quiz...' : 'Gerar quiz completo (10 perguntas)'}
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

          {mode === 'milzao' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t pt-4 mt-4">
              <div className="space-y-2 md:col-span-1">
                <Label>Posição no Quiz do Milhão (1 a 10)</Label>
                {currentMilhaoLevel && (
                  <p className="text-[11px] text-muted-foreground">
                    Nível {currentMilhaoLevel.level} • {currentMilhaoLevel.titulo} • {currentMilhaoLevel.faixa} •{' '}
                    {currentMilhaoLevel.xp} XP
                  </p>
                )}
                <Input
                  type="number"
                  min={1}
                  max={MILHAO_TOTAL}
                  value={slotIndex}
                  onChange={(e) => setSlotIndex(Number(e.target.value) || 1)}
                />
                <Button type="button" variant="outline" className="w-full mt-2" onClick={saveCurrentToSlot}>
                  Usar pergunta atual na posição {clampedSlotIndex}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Crie uma ou mais perguntas manualmente e envie para níveis específicos (do aquecimento à Pergunta do Milhão).
                  Depois, use &quot;Gerar quiz completo&quot; para preencher as demais com IA mantendo a escalada de dificuldade.
                </p>
              </div>
              <div className="md:col-span-2">
                {fullQuiz && Array.isArray(fullQuiz.questoes) && (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-base text-white">
                        Preview do quiz completo ({fullQuiz.tipo === 'milhao' ? 'Quiz do Milhão' : 'Especial'})
                      </Label>
                      <p className="text-xs text-white/70">
                        Revise as 10 perguntas geradas. As posições marcadas manualmente são preservadas.
                      </p>
                    </div>
                    <div className="max-h-[380px] overflow-y-auto space-y-3 pr-1">
                      {Array.from({ length: MILHAO_TOTAL }, (_, idx) => {
                        const q = fullQuiz.questoes?.[idx]
                        if (!q) {
                          return (
                            <div
                              key={idx}
                              className="rounded-xl border border-dashed border-white/30 bg-white/5 p-3 text-xs text-white/70"
                            >
                              Slot {idx + 1}: vazio (será preenchido pela IA ao gerar o quiz completo).
                            </div>
                          )
                        }
                        return (
                          <div
                            key={idx}
                            className="rounded-xl border border-white/30 bg-white/8 p-3 space-y-1 text-white"
                          >
                            <div className="flex items-center justify-between gap-2 text-[11px] text-white/70">
                              <span>
                                Q{idx + 1} • Nível {q.nivel ?? idx + 1} • {q.xp_base ?? ''} XP
                              </span>
                              {manualSlots[idx + 1] && (
                                <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary-foreground text-[10px]">
                                  Manual
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-semibold">
                              {q.enunciado}
                            </p>
                            <ul className="mt-1 text-xs text-white/80 space-y-0.5">
                              {['A','B','C','D'].map((key) => {
                                const text = q.alternativas?.[key] || ''
                                if (!text) return null
                                const mark = q.correta === key ? '✔︎' : '•'
                                return (
                                  <li key={key}>
                                    {mark} {key}) {text}
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {mode !== 'milzao' && fullQuiz && Array.isArray(fullQuiz.questoes) && (
            <div className="space-y-3 border-t pt-4 mt-4">
              <div>
                <Label className="text-base text-white">
                  Preview do quiz completo ({fullQuiz.tipo === 'milhao' ? 'Quiz do Milhão' : 'Especial'})
                </Label>
                <p className="text-xs text-white/70">
                  Revise as 10 perguntas geradas. Use-as como base para criar ou ajustar perguntas no seu desafio.
                </p>
              </div>
              <div className="max-h-[380px] overflow-y-auto space-y-3 pr-1">
                {fullQuiz.questoes.map((q: any, idx: number) => (
                  <div
                    key={q.id ?? idx}
                    className="rounded-xl border border-white/30 bg-white/8 p-3 space-y-1 text-white"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white/70">
                        Q{idx + 1} • Nível {q.nivel ?? idx + 1} • {q.xp_base ?? ''} XP
                      </p>
                    </div>
                    <p className="text-sm font-semibold">
                      {q.enunciado}
                    </p>
                    <ul className="mt-1 text-xs text-white/80 space-y-0.5">
                      {['A','B','C','D'].map((key) => {
                        const text = q.alternativas?.[key] || ''
                        if (!text) return null
                        const mark = q.correta === key ? '✔︎' : '•'
                        return (
                          <li key={key}>
                            {mark} {key}) {text}
                          </li>
                        )
                      })}
                    </ul>
                    <div className="pt-2 flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="text-[11px]"
                        onClick={() => {
                          const alts = q.alternativas || {}
                          const keys = ['A','B','C','D']
                          const correctKey = q.correta || 'A'
                          setQuestion(q.enunciado || '')
                          setCorrectText(alts[correctKey] || '')
                          const wrongList = keys.filter(k => k !== correctKey).map(k => ({
                            text: alts[k] || '',
                            explanation: '',
                          }))
                          setWrongs(Array.from({ length: WRONG_COUNT }, (_, i) => wrongList[i] || { text: '', explanation: '' }))
                        }}
                      >
                        Carregar no editor
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {mode === 'milzao' && (
            <div className="pt-4 flex justify-end">
              <Button
                type="button"
                variant="game"
                onClick={handlePublish}
                disabled={loading || !fullQuiz}
              >
                {loading ? 'Publicando...' : 'Publicar Quiz do Milhão para todos'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
