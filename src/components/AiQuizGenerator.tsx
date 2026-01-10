import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { apiFetch } from '@/lib/api'
import { getActiveLocale } from '@/lib/i18n/activeLocale'
import { localeToOpenAiLanguageTag } from '@/lib/i18n/language'
import { ForumKbThemeSelector, type ForumKbSelection } from '@/components/ForumKbThemeSelector'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type QuizFlow = 'single' | 'multi' | 'milhao'
type WizardStep = 'type' | 'content' | 'questions'
type DifficultyKey = 'basico' | 'intermediario' | 'avancado' | 'especialista'

const LETTERS = ['A', 'B', 'C', 'D'] as const
type Letter = (typeof LETTERS)[number]

const XP_TIERS: Array<{ key: DifficultyKey; label: string; xp: number; hint: string }> = [
  { key: 'basico', label: 'Básico', xp: 5, hint: 'conceitos e recall' },
  { key: 'intermediario', label: 'Intermediário', xp: 10, hint: 'aplicação e interpretação' },
  { key: 'avancado', label: 'Avançado', xp: 20, hint: 'cenários e procedimentos' },
  { key: 'especialista', label: 'Especialista', xp: 50, hint: 'trade-offs e detalhes críticos' },
]

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
] as const

type QuizChallenge = { id: string; title: string; type: string }

type CatalogSource = {
  id: string
  title: string
  summary?: string | null
  created_at?: string | null
  last_used_at?: string | null
  scope?: string | null
  published?: boolean | null
  ingest_status?: 'pending' | 'ok' | 'failed' | null
}

type CompendiumItem = {
  id: string
  updated_at?: string | null
  source_path?: string | null
  catalog?: any | null
  final?: any | null
}

type QuestionDraft = {
  level: number
  question_text: string
  options: Record<Letter, string>
  correct_letter: Letter
  explanation: string
  difficulty_level: DifficultyKey
  xp_value: number
}

const emptyOptions = (): Record<Letter, string> => ({ A: '', B: '', C: '', D: '' })

const normalizeText = (value: string) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const stringifyCompendiumToDataset = (it: CompendiumItem) => {
  const catalog = it?.catalog && typeof it.catalog === 'object' ? it.catalog : null
  const kind = String((it?.final as any)?.kind || (it?.final as any)?.catalog?.kind || (it?.final as any)?.kind || '').trim()
  const title = String(catalog?.title || 'Item do Compêndio').trim() || 'Item do Compêndio'
  const summary = String(catalog?.summary || '').trim()
  const tags = Array.isArray(catalog?.tags) ? catalog.tags : Array.isArray(catalog?.keywords) ? catalog.keywords : []
  const keyPoints = Array.isArray(catalog?.key_points) ? catalog.key_points : Array.isArray(catalog?.learning_points) ? catalog.learning_points : []
  const suggested = Array.isArray(catalog?.suggested_quiz_topics) ? catalog.suggested_quiz_topics : []

  const lines = [
    `Origem: Compêndio`,
    kind ? `Tipo: ${kind}` : null,
    `Título: ${title}`,
    summary ? `Resumo: ${summary}` : null,
    tags.length ? `Tags: ${tags.map((t: any) => String(t || '').trim()).filter(Boolean).slice(0, 20).join(', ')}` : null,
    keyPoints.length
      ? `Pontos-chave: ${keyPoints.map((t: any) => String(t || '').trim()).filter(Boolean).slice(0, 30).join(' | ')}`
      : null,
    suggested.length
      ? `Tópicos sugeridos: ${suggested.map((t: any) => String(t || '').trim()).filter(Boolean).slice(0, 20).join(' | ')}`
      : null,
    it?.source_path ? `Arquivo: ${String(it.source_path)}` : null,
  ].filter(Boolean)

  return { title, text: lines.join('\n') }
}

const tierToXp = (difficulty: DifficultyKey) => XP_TIERS.find((t) => t.key === difficulty)?.xp ?? 10

const levelToTier = (level: number): DifficultyKey => {
  if (level <= 3) return 'basico'
  if (level <= 6) return 'intermediario'
  if (level <= 8) return 'avancado'
  return 'especialista'
}

const createEmptyDraft = (level: number, difficulty: DifficultyKey, xp: number): QuestionDraft => ({
  level,
  question_text: '',
  options: emptyOptions(),
  correct_letter: 'A',
  explanation: '',
  difficulty_level: difficulty,
  xp_value: xp,
})

export const AiQuizGenerator = ({ defaultChallengeId }: { defaultChallengeId?: string }) => {
  const [step, setStep] = useState<WizardStep>('type')
  const [flow, setFlow] = useState<QuizFlow | null>(null)
  const [difficulty, setDifficulty] = useState<DifficultyKey>('intermediario')
  const [questionCount, setQuestionCount] = useState<number>(10)

  const [topic, setTopic] = useState('')
  const [context, setContext] = useState('')

  const [specialties, setSpecialties] = useState<string>('')

  const [rewardMode, setRewardMode] = useState<'fixed_xp' | 'tier_steps'>('fixed_xp')
  const [rewardTotalXp, setRewardTotalXp] = useState<number>(1000)
  const [rewardTierSteps, setRewardTierSteps] = useState<number>(1)

  const [quizChallenges, setQuizChallenges] = useState<QuizChallenge[]>([])
  const [targetChallengeId, setTargetChallengeId] = useState('')

  const [studySources, setStudySources] = useState<CatalogSource[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogShowAll, setCatalogShowAll] = useState(false)
  const [catalogVigentesOnly, setCatalogVigentesOnly] = useState(true)

  const [compendiumItems, setCompendiumItems] = useState<CompendiumItem[]>([])
  const [compendiumQuery, setCompendiumQuery] = useState('')
  const [compendiumShowAll, setCompendiumShowAll] = useState(false)
  const [selectedCompendiumIds, setSelectedCompendiumIds] = useState<string[]>([])

  const [sourcePickerTab, setSourcePickerTab] = useState<'catalog' | 'compendium' | 'online'>('catalog')
  const [sourceUrls, setSourceUrls] = useState<string[]>([])
  const [onlineUrlInput, setOnlineUrlInput] = useState('')
  const [webQuery, setWebQuery] = useState('')

  const [datasetTitle, setDatasetTitle] = useState('')
  const [datasetText, setDatasetText] = useState('')

  const [kbEnabled, setKbEnabled] = useState(false)
  const [kbSelection, setKbSelection] = useState<ForumKbSelection | null>(null)

  const [resolvedWebContext, setResolvedWebContext] = useState<string>('')
  const [resolvedUrlSourceIds, setResolvedUrlSourceIds] = useState<string[]>([])

  const [drafts, setDrafts] = useState<QuestionDraft[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  const [busy, setBusy] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)

  const totalQuestions = useMemo(() => {
    if (flow === 'milhao') return 10
    if (flow === 'single') return 1
    return Math.max(1, Math.min(50, Number(questionCount) || 1))
  }, [flow, questionCount])

  const filledCount = useMemo(
    () => drafts.filter((q) => String(q.question_text || '').trim().length > 0).length,
    [drafts],
  )

  // Focus mode: hide bottom navigation while editing questions on mobile.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const isMobile = window.matchMedia?.('(max-width: 768px)')?.matches ?? false
    const hidden = Boolean(isMobile && step === 'questions')
    window.dispatchEvent(new CustomEvent('djt-nav-visibility', { detail: { hidden } }))
    return () => window.dispatchEvent(new CustomEvent('djt-nav-visibility', { detail: { hidden: false } }))
  }, [step])

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('challenges')
        .select('id, title, type')
        .eq('type', 'quiz')
        .order('title')
        .limit(250)
      const list = (data || []) as any[]
      setQuizChallenges(list as any)
      if (defaultChallengeId && list.some((c: any) => c.id === defaultChallengeId)) {
        setTargetChallengeId(defaultChallengeId)
      }
    })()
  }, [defaultChallengeId])

  useEffect(() => {
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('study_sources')
          .select('id, title, summary, created_at, last_used_at, scope, published, ingest_status')
          .order('last_used_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(300)
        if (!error && Array.isArray(data)) setStudySources(data as any)
      } catch {
        // ignore
      }
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const { data: session } = await supabase.auth.getSession()
        const token = session.session?.access_token
        if (!token) return
        const resp = await apiFetch('/api/admin?handler=compendium-list', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
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

  useEffect(() => {
    if (!flow) return
    setDrafts((prev) => {
      const next: QuestionDraft[] = []
      for (let i = 0; i < totalQuestions; i++) {
        const level = i + 1
        const existing = prev[i]
        if (flow === 'milhao') {
          const tier = levelToTier(level)
          const xp = MILHAO_LEVELS[i]?.xp ?? 0
          next.push(existing ? { ...existing, level, difficulty_level: tier, xp_value: xp } : createEmptyDraft(level, tier, xp))
        } else {
          const xp = tierToXp(difficulty)
          next.push(existing ? { ...existing, level, difficulty_level: difficulty, xp_value: xp } : createEmptyDraft(level, difficulty, xp))
        }
      }
      return next
    })
    setActiveIndex(0)
  }, [flow, totalQuestions, difficulty])

  const RECENT_DAYS = 180
  const isRecentSource = (s: CatalogSource) => {
    const raw = s.last_used_at || s.created_at || ''
    const ts = Date.parse(String(raw))
    if (!Number.isFinite(ts)) return true
    return ts >= Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
  }

  const visibleCatalogSuggestions = useMemo(() => {
    const q = normalizeText(catalogQuery)
    return studySources
      .filter((s) => (catalogShowAll || q.length > 0 ? true : isRecentSource(s)))
      .filter((s) => (catalogVigentesOnly ? String(s.scope || '').toLowerCase() === 'org' && Boolean(s.published) : true))
      .filter((s) => s.ingest_status == null || s.ingest_status === 'ok')
      .filter((s) => {
        if (!q) return true
        const hay = normalizeText([s.title, s.summary].filter(Boolean).join(' '))
        return hay.includes(q)
      })
      .slice(0, 12)
  }, [catalogQuery, catalogShowAll, catalogVigentesOnly, studySources])

  const isRecentCompendium = (it: CompendiumItem) => {
    const ts = Date.parse(String(it?.updated_at || ''))
    if (!Number.isFinite(ts)) return true
    return ts >= Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
  }

  const visibleCompendiumSuggestions = useMemo(() => {
    const q = normalizeText(compendiumQuery)
    return compendiumItems
      .filter((it) => (compendiumShowAll || q.length > 0 ? true : isRecentCompendium(it)))
      .filter((it) => {
        if (!q) return true
        const title = String(it?.catalog?.title || '')
        const summary = String(it?.catalog?.summary || '')
        const hay = normalizeText(`${title} ${summary}`)
        return hay.includes(q)
      })
      .slice(0, 12)
  }, [compendiumItems, compendiumQuery, compendiumShowAll])

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

  const removeCatalogSource = (id: string) => setSelectedSourceIds((prev) => prev.filter((x) => x !== id))
  const removeCompendiumItem = (id: string) => setSelectedCompendiumIds((prev) => prev.filter((x) => x !== id))
  const removeOnlineUrl = (url: string) => setSourceUrls((prev) => prev.filter((x) => x !== url))
  const clearSelections = () => {
    setSelectedSourceIds([])
    setSelectedCompendiumIds([])
    setSourceUrls([])
    setResolvedUrlSourceIds([])
    setWebQuery('')
    setResolvedWebContext('')
    setKbEnabled(false)
    setKbSelection(null)
  }

  const ensureStep = (next: WizardStep) => setStep(next)

  const canContinueFromType = Boolean(flow) && (flow !== 'multi' || (Number.isFinite(questionCount) && questionCount >= 2 && questionCount <= 50))

  const computeAvoidList = (baseDrafts: QuestionDraft[], avoidIndex: number) =>
    baseDrafts
      .map((d, idx) => (idx === avoidIndex ? '' : String(d.question_text || '').trim()))
      .filter(Boolean)
      .slice(0, 8)

  const buildStudyQuizBody = (params: {
    mode: 'standard' | 'milhao'
    count: number
    milhaoStartLevel?: number
    avoid: string[]
  }) => {
    const hasDataset = datasetText.trim().length > 0
    const hasSources = selectedSourceIds.length > 0 || resolvedUrlSourceIds.length > 0
    const hasKb = Boolean(kbEnabled && kbSelection?.tags?.length)
    const hasCompendium = selectedCompendiumIds.length > 0
    const hasUrls = sourceUrls.length > 0
    const hasWebQuery = webQuery.trim().length > 0

    if (!topic.trim() && !context.trim() && !hasDataset && !hasSources && !hasKb && !hasCompendium && !hasUrls && !hasWebQuery) {
      throw new Error('Informe ao menos um tema/contexto ou selecione fontes.')
    }

    const specialtiesList = specialties
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12)

    const avoidLine = params.avoid.length ? `Não repita perguntas já geradas (evite): ${params.avoid.join(' | ')}` : ''

    const instructions = [
      avoidLine,
      'Regras: 4 alternativas (A-D), apenas 1 correta e 3 erradas (plausíveis).',
      params.mode === 'standard'
        ? `Dificuldade alvo: ${difficulty} (XP ${tierToXp(difficulty)}). Use isso para calibrar a complexidade.`
        : '',
      'Se não houver normas/textos fornecidos, não invente padrões internos; use boas práticas e conceitos gerais do setor elétrico.',
    ]
      .filter(Boolean)
      .join('\n')

    const mergedSourceIds = Array.from(new Set([...selectedSourceIds, ...resolvedUrlSourceIds])).filter(Boolean).slice(0, 24)
    const source_urls =
      resolvedUrlSourceIds.length === 0
        ? sourceUrls
            .filter(Boolean)
            .slice(0, 8)
            .map((u) => ({ url: u }))
        : []

    const sources = [
      ...(hasDataset
        ? [
            {
              title: datasetTitle || topic || 'Base de estudo deste quiz',
              text: datasetText,
            },
          ]
        : []),
      ...selectedCompendiumIds
        .map((id) => compendiumItems.find((x) => x.id === id) || null)
        .filter(Boolean)
        .map((it) => stringifyCompendiumToDataset(it as any)),
    ]

    const useResolvedWeb = resolvedWebContext.trim().length > 0
    const shouldFetchWeb = !useResolvedWeb && hasWebQuery
    const shouldSaveUrls = !resolvedUrlSourceIds.length && source_urls.length > 0

    return {
      mode: params.mode,
      language: localeToOpenAiLanguageTag(getActiveLocale()),
      topic: topic.trim(),
      context: context.trim(),
      specialties: specialtiesList,
      instructions,
      sources,
      ...(mergedSourceIds.length ? { source_ids: mergedSourceIds } : {}),
      ...(source_urls.length ? { source_urls } : {}),
      ...(shouldSaveUrls ? { save_source: true } : {}),
      ...(useResolvedWeb ? { web_context: resolvedWebContext.trim() } : {}),
      ...(shouldFetchWeb ? { web_query: webQuery.trim() } : {}),
      ...(hasKb ? { kb_tags: kbSelection!.tags, kb_focus: kbSelection!.label } : {}),
      question_count: params.count,
      ...(params.mode === 'milhao' && params.milhaoStartLevel ? { milhao_level_start: params.milhaoStartLevel, refine_distractors: false } : {}),
      ...(params.mode === 'standard' ? { difficulty_level: difficulty, xp_value: tierToXp(difficulty) } : {}),
    }
  }

  const applyWebAndUrlCaches = (json: any) => {
    const webCtx = String(json?.web_context || '').trim()
    if (webCtx && !resolvedWebContext.trim()) setResolvedWebContext(webCtx)
    const saved = Array.isArray(json?.saved_sources) ? json.saved_sources : []
    const ids = saved.map((s: any) => String(s?.id || '').trim()).filter(Boolean)
    if (ids.length) {
      setResolvedUrlSourceIds((prev) => Array.from(new Set([...prev, ...ids])).slice(0, 24))
      setSourceUrls([])
    }
  }

  const fetchAiDraftAt = async (index: number, baseDrafts?: QuestionDraft[]) => {
    if (!flow) throw new Error('Selecione o tipo de quiz.')
    const { data: session } = await supabase.auth.getSession()
    const token = session.session?.access_token
    const mode = flow === 'milhao' ? 'milhao' : 'standard'
    const body = buildStudyQuizBody({
      mode,
      count: 1,
      avoid: computeAvoidList(baseDrafts || drafts, index),
      ...(mode === 'milhao' ? { milhaoStartLevel: index + 1 } : {}),
    })

    const resp = await apiFetch('/api/ai?handler=study-quiz', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(json?.error || 'Falha ao gerar pergunta')

    applyWebAndUrlCaches(json)

    const payload = (json as any)?.quiz || json
    const questions = Array.isArray((payload as any)?.questions) ? (payload as any).questions : []
    const q0 = questions[0]
    if (!q0) throw new Error('A IA não retornou pergunta.')

    const next: QuestionDraft = {
      level: Number(q0.level || index + 1) || index + 1,
      question_text: String(q0.question_text || '').trim(),
      options: {
        A: String(q0.options?.A || '').trim(),
        B: String(q0.options?.B || '').trim(),
        C: String(q0.options?.C || '').trim(),
        D: String(q0.options?.D || '').trim(),
      },
      correct_letter: (String(q0.correct_letter || 'A').trim().toUpperCase() as Letter) || 'A',
      explanation: String(q0.explanation || '').trim(),
      difficulty_level: flow === 'milhao' ? levelToTier(index + 1) : difficulty,
      xp_value: flow === 'milhao' ? (MILHAO_LEVELS[index]?.xp ?? 0) : tierToXp(difficulty),
    }

    if (!next.question_text || LETTERS.some((L) => !next.options[L])) {
      throw new Error('Pergunta retornada em formato incompleto. Tente novamente.')
    }
    return next
  }

  const generateAt = async (index: number, opts?: { force?: boolean }) => {
    if (!flow) return
    if (!opts?.force && String(drafts[index]?.question_text || '').trim().length > 0) return

    setBusy(true)
    setGenerationStatus(`Gerando Q${index + 1}...`)
    setGenerationProgress(15)
    try {
      setGenerationProgress(40)
      const next = await fetchAiDraftAt(index)
      setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...next } : d)))
      setGenerationProgress(100)
      toast(`Q${index + 1} gerada.`)
    } catch (e: any) {
      toast(e?.message || 'Falha ao gerar pergunta')
      throw e
    } finally {
      setBusy(false)
      window.setTimeout(() => {
        setGenerationStatus(null)
        setGenerationProgress(0)
      }, 700)
    }
  }

  const generateAllMissing = async (opts?: { force?: boolean }) => {
    if (!flow) return
    setBusy(true)
    setGenerationStatus('Gerando perguntas...')
    setGenerationProgress(5)
    try {
      const working = drafts.map((d) => ({ ...d, options: { ...d.options } }))
      for (let i = 0; i < totalQuestions; i++) {
        const hasText = String(working[i]?.question_text || '').trim().length > 0
        if (!opts?.force && hasText) continue
        setActiveIndex(i)
        setGenerationStatus(`Gerando Q${i + 1} de ${totalQuestions}...`)
        setGenerationProgress(Math.round((i / totalQuestions) * 90) + 5)
        const next = await fetchAiDraftAt(i, working)
        working[i] = { ...working[i], ...next }
        setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...next } : d)))
      }
      setGenerationProgress(100)
      toast('Geração concluída.')
    } catch {
      // toast already shown
    } finally {
      setBusy(false)
      window.setTimeout(() => {
        setGenerationStatus(null)
        setGenerationProgress(0)
      }, 700)
    }
  }

  const validateDraft = (d: QuestionDraft) => {
    if (String(d.question_text || '').trim().length < 5) return false
    const present = LETTERS.filter((L) => String(d.options[L] || '').trim().length >= 2)
    if (present.length !== 4) return false
    if (!LETTERS.includes(d.correct_letter)) return false
    return true
  }

  const toStudioOptions = (d: QuestionDraft) =>
    LETTERS.map((L) => ({
      option_text: String(d.options[L] || '').trim(),
      is_correct: L === d.correct_letter,
      explanation: L === d.correct_letter ? String(d.explanation || '').trim() : '',
    }))

  const insertOne = async (index: number) => {
    if (!targetChallengeId) {
      toast('Selecione um quiz destino para inserir perguntas.')
      return
    }
    const d = drafts[index]
    if (!d || !validateDraft(d)) {
      toast(`Q${index + 1} está incompleta.`)
      return
    }
    setBusy(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Não autenticado')
      const resp = await apiFetch('/api/admin?handler=studio-create-quiz-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          challengeId: targetChallengeId,
          question_text: d.question_text,
          difficulty_level: d.difficulty_level,
          options: toStudioOptions(d),
        }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(json?.error || 'Falha ao inserir pergunta')
      toast(`Q${index + 1} inserida no quiz.`)
    } catch (e: any) {
      toast(e?.message || 'Falha ao inserir pergunta')
    } finally {
      setBusy(false)
    }
  }

  const insertAll = async () => {
    if (!targetChallengeId) {
      toast('Selecione um quiz destino para inserir perguntas.')
      return
    }
    const ready = drafts.filter((d) => validateDraft(d))
    if (!ready.length) {
      toast('Nenhuma pergunta completa para inserir.')
      return
    }
    setBusy(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Não autenticado')
      let ok = 0
      let skipped = 0
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i]
        if (!validateDraft(d)) {
          skipped++
          continue
        }
        const resp = await apiFetch('/api/admin?handler=studio-create-quiz-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            challengeId: targetChallengeId,
            question_text: d.question_text,
            difficulty_level: d.difficulty_level,
            options: toStudioOptions(d),
          }),
        })
        const json = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(json?.error || `Falha ao inserir Q${i + 1}`)
        ok++
      }
      toast(`Perguntas inseridas: ${ok}${skipped ? ` • ignoradas: ${skipped}` : ''}`)
    } catch (e: any) {
      toast(e?.message || 'Falha ao inserir perguntas')
    } finally {
      setBusy(false)
    }
  }

  const handlePublishMilhao = async () => {
    if (flow !== 'milhao') return
    if (drafts.length !== 10) {
      toast('O Quiz do Milhão precisa ter 10 perguntas.')
      return
    }
    if (drafts.some((d) => !validateDraft(d))) {
      toast('Preencha/valide todas as 10 perguntas antes de publicar.')
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
      setBusy(true)
      const quiz = {
        tipo: 'milhao',
        questoes: drafts.map((d, idx) => ({
          id: idx + 1,
          nivel: idx + 1,
          enunciado: d.question_text,
          alternativas: d.options,
          correta: d.correct_letter,
          xp_base: MILHAO_LEVELS[idx]?.xp ?? null,
        })),
      }
      const resp = await apiFetch('/api/admin?handler=studio-publish-quiz-milhao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          quiz,
          reward: {
            mode: rewardMode,
            total_xp: rewardMode === 'fixed_xp' ? Number(rewardTotalXp || 0) : undefined,
            tier_steps: rewardMode === 'tier_steps' ? Number(rewardTierSteps || 0) : undefined,
          },
        }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(json?.error || 'Falha ao publicar Quiz do Milhão')
      toast(`Quiz do Milhão publicado: ${json?.title || ''}`)
    } catch (e: any) {
      toast(e?.message || 'Falha ao publicar Quiz do Milhão')
    } finally {
      setBusy(false)
    }
  }

  const active = drafts[activeIndex] || createEmptyDraft(activeIndex + 1, difficulty, tierToXp(difficulty))

  const selectedCatalogSources = useMemo(
    () =>
      selectedSourceIds
        .map((id) => studySources.find((s) => s.id === id) || null)
        .filter(Boolean) as CatalogSource[],
    [selectedSourceIds, studySources],
  )

  const selectedCompendiumSources = useMemo(
    () =>
      selectedCompendiumIds
        .map((id) => compendiumItems.find((it) => it.id === id) || null)
        .filter(Boolean) as CompendiumItem[],
    [selectedCompendiumIds, compendiumItems],
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Gerador de Quiz (IA)</CardTitle>
          <CardDescription>
            Escolha o tipo (1 pergunta, múltiplas ou Quiz do Milhão), selecione fontes vigentes (StudyLab/Compêndio/Online) e edite questão a
            questão (manual ou com IA).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
            <div className="text-xs text-muted-foreground">
              Etapa: <span className="font-semibold text-foreground">{step === 'type' ? 'Tipo' : step === 'content' ? 'Conteúdo' : 'Perguntas'}</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={step === 'type' || busy} onClick={() => ensureStep(step === 'questions' ? 'content' : 'type')}>
                Voltar
              </Button>
              <Button
                type="button"
                variant="game"
                size="sm"
                disabled={busy || (step === 'type' ? !canContinueFromType : step === 'content' ? !flow : false)}
                onClick={() => ensureStep(step === 'type' ? 'content' : 'questions')}
              >
                Continuar
              </Button>
            </div>
          </div>

          {busy && generationStatus && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{generationStatus}</span>
                <span>{generationProgress}%</span>
              </div>
              <Progress value={generationProgress} className="h-2" />
            </div>
          )}

          {step === 'type' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Button
                  type="button"
                  variant={flow === 'single' ? 'game' : 'outline'}
                  className="h-auto justify-start py-3"
                  onClick={() => setFlow('single')}
                >
                  <div className="text-left">
                    <div className="font-semibold">Quiz unitário</div>
                    <div className="text-xs opacity-80">1 pergunta (A-D)</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={flow === 'multi' ? 'game' : 'outline'}
                  className="h-auto justify-start py-3"
                  onClick={() => setFlow('multi')}
                >
                  <div className="text-left">
                    <div className="font-semibold">Múltiplas perguntas</div>
                    <div className="text-xs opacity-80">2 a 50 perguntas</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={flow === 'milhao' ? 'game' : 'outline'}
                  className="h-auto justify-start py-3"
                  onClick={() => setFlow('milhao')}
                >
                  <div className="text-left">
                    <div className="font-semibold">Quiz do Milhão</div>
                    <div className="text-xs opacity-80">10 níveis progressivos</div>
                  </div>
                </Button>
              </div>

              {flow === 'multi' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Quantidade de perguntas</Label>
                    <Input
                      type="number"
                      min={2}
                      max={50}
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Math.max(2, Math.min(50, Number(e.target.value) || 2)))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Destino (opcional)</Label>
                    <Select value={targetChallengeId} onValueChange={setTargetChallengeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Inserir em um quiz existente" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Sem destino (apenas gerar)</SelectItem>
                        {quizChallenges.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {flow === 'single' && (
                <div className="space-y-2">
                  <Label>Destino (opcional)</Label>
                  <Select value={targetChallengeId} onValueChange={setTargetChallengeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Inserir em um quiz existente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Sem destino (apenas gerar)</SelectItem>
                      {quizChallenges.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {flow !== 'milhao' && (
                <div className="space-y-2">
                  <Label>Dificuldade / XP por pergunta</Label>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    {XP_TIERS.map((t) => (
                      <Button
                        key={t.key}
                        type="button"
                        variant={difficulty === t.key ? 'game' : 'outline'}
                        className="h-auto justify-start py-2"
                        onClick={() => setDifficulty(t.key)}
                      >
                        <div className="text-left">
                          <div className="font-semibold">
                            {t.label} • {t.xp} XP
                          </div>
                          <div className="text-xs opacity-80">{t.hint}</div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {flow === 'milhao' && (
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
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
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'content' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tema (opcional)</Label>
                  <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ex.: NR10, subtransmissão, segurança..." />
                </div>
                <div className="space-y-2">
                  <Label>Especialidades (opcional)</Label>
                  <Input value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="Ex.: seguranca, protecao, telecom (separar por vírgula)" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Contexto (opcional)</Label>
                  <Textarea rows={2} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Cenário, restrições, observações..." />
                </div>
              </div>

              <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">Fontes</div>
                    <div className="text-xs text-muted-foreground">Catálogo (StudyLab), Compêndio ou Online (URL/pesquisa).</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={kbEnabled} onCheckedChange={setKbEnabled} />
                    <span className="text-xs text-muted-foreground">Usar histórico de dúvidas (KB)</span>
                  </div>
                </div>

                {kbEnabled && (
                  <ForumKbThemeSelector value={kbSelection} onChange={setKbSelection} title="Filtrar dúvidas por tema" />
                )}

                <Tabs value={sourcePickerTab} onValueChange={(v) => setSourcePickerTab(v as any)}>
                  <TabsList className="grid grid-cols-3">
                    <TabsTrigger value="catalog">Catálogo</TabsTrigger>
                    <TabsTrigger value="compendium">Compêndio</TabsTrigger>
                    <TabsTrigger value="online">Online</TabsTrigger>
                  </TabsList>

                  <TabsContent value="catalog" className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Switch checked={catalogVigentesOnly} onCheckedChange={setCatalogVigentesOnly} />
                        <span className="text-xs text-muted-foreground">Somente vigentes (org)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={catalogShowAll} onCheckedChange={setCatalogShowAll} />
                        <span className="text-xs text-muted-foreground">Mostrar antigos</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Buscar fonte do StudyLab</Label>
                      <Input value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Digite para filtrar..." />
                      {visibleCatalogSuggestions.length > 0 && (
                        <div className="rounded-md border bg-background/40 p-2 space-y-1">
                          {visibleCatalogSuggestions.map((s) => (
                            <button
                              type="button"
                              key={s.id}
                              className="w-full text-left text-sm rounded-md px-2 py-1 hover:bg-muted"
                              onClick={() => addCatalogSource(s.id)}
                            >
                              <div className="font-medium">{s.title}</div>
                              {s.summary ? <div className="text-xs text-muted-foreground line-clamp-1">{s.summary}</div> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="compendium" className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div />
                      <div className="flex items-center gap-2">
                        <Switch checked={compendiumShowAll} onCheckedChange={setCompendiumShowAll} />
                        <span className="text-xs text-muted-foreground">Mostrar antigos</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Buscar item do Compêndio</Label>
                      <Input value={compendiumQuery} onChange={(e) => setCompendiumQuery(e.target.value)} placeholder="Digite para filtrar..." />
                      {visibleCompendiumSuggestions.length > 0 && (
                        <div className="rounded-md border bg-background/40 p-2 space-y-1">
                          {visibleCompendiumSuggestions.map((it) => (
                            <button
                              type="button"
                              key={it.id}
                              className="w-full text-left text-sm rounded-md px-2 py-1 hover:bg-muted"
                              onClick={() => addCompendiumItem(it.id)}
                            >
                              <div className="font-medium">{String(it?.catalog?.title || 'Item do Compêndio')}</div>
                              {it?.catalog?.summary ? (
                                <div className="text-xs text-muted-foreground line-clamp-1">{String(it.catalog.summary)}</div>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="online" className="space-y-3">
                    <div className="space-y-2">
                      <Label>URL (opcional)</Label>
                      <div className="flex gap-2">
                        <Input value={onlineUrlInput} onChange={(e) => setOnlineUrlInput(e.target.value)} placeholder="https://..." />
                        <Button type="button" variant="outline" onClick={addOnlineUrl} disabled={!onlineUrlInput.trim()}>
                          Adicionar
                        </Button>
                      </div>
                      {sourceUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {sourceUrls.map((u) => (
                            <Button
                              key={u}
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => removeOnlineUrl(u)}
                            >
                              {u.replace('https://', '').replace('http://', '').slice(0, 42)}
                              {u.length > 50 ? '…' : ''}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Pesquisa web (opcional)</Label>
                      <Input
                        value={webQuery}
                        onChange={(e) => {
                          setWebQuery(e.target.value)
                          setResolvedWebContext('')
                        }}
                        placeholder="Ex.: NR-10 seccionamento e bloqueio LOTO"
                      />
                      {resolvedWebContext.trim() ? (
                        <p className="text-xs text-muted-foreground">Contexto web já pré-carregado; próximas gerações não refazem a pesquisa.</p>
                      ) : null}
                    </div>
                  </TabsContent>
                </Tabs>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label>Dataset colado (opcional)</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDatasetTitle('')
                        setDatasetText('')
                      }}
                    >
                      Limpar
                    </Button>
                  </div>
                  <Input value={datasetTitle} onChange={(e) => setDatasetTitle(e.target.value)} placeholder="Título (opcional)" />
                  <Textarea rows={3} value={datasetText} onChange={(e) => setDatasetText(e.target.value)} placeholder="Cole trechos de norma/treinamento aqui..." />
                </div>

                {(selectedSourceIds.length > 0 ||
                  selectedCompendiumIds.length > 0 ||
                  sourceUrls.length > 0 ||
                  resolvedUrlSourceIds.length > 0 ||
                  (kbEnabled && kbSelection?.tags?.length) ||
                  webQuery.trim() ||
                  resolvedWebContext.trim()) && (
                  <div className="rounded-lg border bg-background/40 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">Selecionados</div>
                      <Button type="button" variant="outline" size="sm" onClick={clearSelections}>
                        Limpar seleção
                      </Button>
                    </div>

                    {selectedCatalogSources.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Catálogo</div>
                        <div className="flex flex-wrap gap-2">
                          {selectedCatalogSources.map((s) => (
                            <Button key={s.id} type="button" size="sm" variant="secondary" onClick={() => removeCatalogSource(s.id)}>
                              {s.title.slice(0, 46)}
                              {s.title.length > 46 ? '…' : ''}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedCompendiumSources.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Compêndio</div>
                        <div className="flex flex-wrap gap-2">
                          {selectedCompendiumSources.map((it) => {
                            const title = String(it?.catalog?.title || 'Item do Compêndio')
                            return (
                              <Button key={it.id} type="button" size="sm" variant="secondary" onClick={() => removeCompendiumItem(it.id)}>
                                {title.slice(0, 46)}
                                {title.length > 46 ? '…' : ''}
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {(sourceUrls.length > 0 || resolvedUrlSourceIds.length > 0) && (
                      <div className="text-xs text-muted-foreground">
                        Online: {resolvedUrlSourceIds.length ? 'URLs já salvas e reutilizadas automaticamente' : `${sourceUrls.length} URL(s)`}
                      </div>
                    )}

                    {(webQuery.trim() || resolvedWebContext.trim()) && (
                      <div className="text-xs text-muted-foreground">
                        Web: {resolvedWebContext.trim() ? 'contexto pré-carregado' : `consulta: "${webQuery.trim().slice(0, 80)}"`}
                      </div>
                    )}

                    {kbEnabled && kbSelection?.tags?.length ? (
                      <div className="text-xs text-muted-foreground">KB: {kbSelection.label}</div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'questions' && flow && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">
                    Perguntas ({filledCount}/{totalQuestions})
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {flow === 'milhao' ? '10 níveis progressivos.' : `Cada pergunta vale ${tierToXp(difficulty)} XP (${difficulty}).`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => generateAt(activeIndex, { force: true })}>
                    Gerar Q{activeIndex + 1}
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => generateAllMissing()}>
                    Gerar faltantes
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => generateAllMissing({ force: true })}>
                    Regenerar tudo
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Navegação</Label>
                  <Select value={String(activeIndex)} onValueChange={(v) => setActiveIndex(Number(v) || 0)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {drafts.map((d, idx) => (
                        <SelectItem key={idx} value={String(idx)}>
                          Q{idx + 1} {String(d.question_text || '').trim() ? '• pronta' : '• vazia'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {flow === 'milhao' && MILHAO_LEVELS[activeIndex] && (
                    <p className="text-[11px] text-muted-foreground">
                      Nível {activeIndex + 1} • {MILHAO_LEVELS[activeIndex].titulo} • {MILHAO_LEVELS[activeIndex].faixa} • {MILHAO_LEVELS[activeIndex].xp} XP
                    </p>
                  )}

                  {flow !== 'milhao' && (
                    <div className="space-y-2">
                      <Label>Destino (opcional)</Label>
                      <Select value={targetChallengeId} onValueChange={setTargetChallengeId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Inserir em um quiz existente" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Sem destino (apenas gerar)</SelectItem>
                          {quizChallenges.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" disabled={busy || !targetChallengeId} onClick={() => insertOne(activeIndex)}>
                          Inserir Q{activeIndex + 1}
                        </Button>
                        <Button type="button" variant="game" disabled={busy || !targetChallengeId} onClick={insertAll}>
                          Inserir todas
                        </Button>
                      </div>
                    </div>
                  )}

                  {flow === 'milhao' && (
                    <div className="space-y-2">
                      <Button type="button" variant="game" disabled={busy} onClick={handlePublishMilhao}>
                        Publicar Quiz do Milhão para todos
                      </Button>
                    </div>
                  )}
                </div>

                <div className="md:col-span-2 space-y-3">
                  <div className="space-y-2">
                    <Label>Pergunta (Q{activeIndex + 1})</Label>
                    <Textarea
                      rows={3}
                      value={active.question_text}
                      onChange={(e) =>
                        setDrafts((prev) => prev.map((d, i) => (i === activeIndex ? { ...d, question_text: e.target.value } : d)))
                      }
                      placeholder="Enunciado da pergunta..."
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Alternativas (A-D)</Label>
                      <div className="space-y-2">
                        {LETTERS.map((L) => (
                          <div key={L} className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={active.correct_letter === L ? 'game' : 'outline'}
                              onClick={() => setDrafts((prev) => prev.map((d, i) => (i === activeIndex ? { ...d, correct_letter: L } : d)))}
                            >
                              {L}
                            </Button>
                            <Input
                              value={active.options[L]}
                              onChange={(e) =>
                                setDrafts((prev) =>
                                  prev.map((d, i) =>
                                    i === activeIndex ? { ...d, options: { ...d.options, [L]: e.target.value } } : d,
                                  ),
                                )
                              }
                              placeholder={`Alternativa ${L}`}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Clique na letra para marcar a correta. A ordem é embaralhada automaticamente ao inserir no quiz.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Explicação (opcional)</Label>
                      <Textarea
                        rows={5}
                        value={active.explanation}
                        onChange={(e) =>
                          setDrafts((prev) => prev.map((d, i) => (i === activeIndex ? { ...d, explanation: e.target.value } : d)))
                        }
                        placeholder="Por que a alternativa correta é a correta..."
                      />
                      <div className="text-xs text-muted-foreground">
                        {validateDraft(active) ? 'OK para inserir/publicar.' : 'Complete enunciado + 4 alternativas (A-D) + correta.'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
