import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { QuizQuestionForm } from './QuizQuestionForm';
import { QuizQuestionsList } from './QuizQuestionsList';
import { apiFetch } from '@/lib/api';
import { CompendiumPicker } from '@/components/CompendiumPicker';
import { getActiveLocale } from '@/lib/i18n/activeLocale';
import { localeToOpenAiLanguageTag } from '@/lib/i18n/language';

const inferQuestionCountFromText = (raw: string) => {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  // Matches headers like: "Questão 1", "Pergunta 2", "Q3", "Questao 4"
  const matches = text.match(/^\s*(?:Q(?:uest[aã]o)?|Quest[aã]o|Questao|Pergunta)\s*\d+\b/gim) || [];
  const count = matches.length;
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(50, count);
};

const quizSchema = z.object({
  title: z.string().min(3, "Título deve ter no mínimo 3 caracteres"),
  description: z
    .string()
    .trim()
    .default('')
    .refine((val) => val.length === 0 || val.length >= 10, {
      message: "Descrição deve ter no mínimo 10 caracteres quando preenchida",
    }),
  xp_reward: z.coerce
    .number()
    .refine((v) => [5, 10, 20, 50].includes(Number(v)), { message: "Selecione 5 / 10 / 20 / 50" }),
  quiz_specialties: z.array(z.string()).optional(),
  chas_dimension: z.enum(['C','H','A','S']).default('C'),
});

type QuizFormData = z.infer<typeof quizSchema>;

const STUDYLAB_CATEGORIES = [
  "ALL",
  "MANUAIS",
  "PROCEDIMENTOS",
  "APOSTILAS",
  "RELATORIO_OCORRENCIA",
  "AUDITORIA_INTERNA",
  "AUDITORIA_EXTERNA",
  "OUTROS",
] as const;

const STUDYLAB_CATEGORY_LABELS: Record<(typeof STUDYLAB_CATEGORIES)[number], string> = {
  ALL: "Todas",
  MANUAIS: "Manuais",
  PROCEDIMENTOS: "Procedimentos",
  APOSTILAS: "Apostilas",
  RELATORIO_OCORRENCIA: "Relatório de Ocorrência",
  AUDITORIA_INTERNA: "Auditoria Interna",
  AUDITORIA_EXTERNA: "Auditoria Externa",
  OUTROS: "Outros",
};

type ImportDifficulty = 'basico' | 'intermediario' | 'avancado' | 'especialista';
type ImportOptionDraft = { text: string; is_correct: boolean; explanation: string };
type ImportQuestionDraft = {
  question_text: string;
  difficulty_level: ImportDifficulty;
  options: ImportOptionDraft[];
  _meta?: { aiImproved?: boolean; regens?: number; edited?: boolean };
};

export function QuizCreationWizard() {
  const [quizId, setQuizId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingForCuration, setIsSubmittingForCuration] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [compOpen, setCompOpen] = useState(false);
  const [studySources, setStudySources] = useState<any[]>([]);
  const [baseSourceId, setBaseSourceId] = useState<string>('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sourceSearch, setSourceSearch] = useState('');
  const [autoQuestionCount, setAutoQuestionCount] = useState<number>(10);
  const [autoProofread, setAutoProofread] = useState(getActiveLocale() === 'pt-BR');
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [quizMeta, setQuizMeta] = useState<{ title: string; description: string }>({ title: '', description: '' });
  const [quizXpReward, setQuizXpReward] = useState<number | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<any[]>([]);
  const [questionSearch, setQuestionSearch] = useState('');
  const [questionSort, setQuestionSort] = useState<'recent' | 'access' | 'relevance'>('recent');
  const [questionCategory, setQuestionCategory] = useState<(typeof STUDYLAB_CATEGORIES)[number]>('ALL');

  const [textImport, setTextImport] = useState<string>('');
  const [textImportDefaultDifficulty, setTextImportDefaultDifficulty] = useState<'basico' | 'intermediario' | 'avancado' | 'especialista'>(
    'intermediario',
  );
  const [textImportAuto, setTextImportAuto] = useState(true);
  const [textImportParsing, setTextImportParsing] = useState(false);
  const [textImportImporting, setTextImportImporting] = useState(false);
  const [textImportPreview, setTextImportPreview] = useState<any[] | null>(null);
  const [textImportIssues, setTextImportIssues] = useState<string[]>([]);
  const [textImportDrafts, setTextImportDrafts] = useState<ImportQuestionDraft[] | null>(null);
  const [textImportAutoImprove, setTextImportAutoImprove] = useState(true);
  const [textImportImproving, setTextImportImproving] = useState(false);
  const [textImportUsedAi, setTextImportUsedAi] = useState<boolean | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const xpToDifficulty = (xp: number): 'basico' | 'intermediario' | 'avancado' | 'especialista' => {
    const n = Number(xp);
    if (n === 5) return 'basico';
    if (n === 10) return 'intermediario';
    if (n === 20) return 'avancado';
    return 'especialista';
  };

  const quizForcedDifficulty = useMemo<'basico' | 'intermediario' | 'avancado' | 'especialista'>(() => {
    const xp = Number(quizXpReward);
    if ([5, 10, 20, 50].includes(xp)) return xpToDifficulty(xp);
    return 'intermediario';
  }, [quizXpReward]);

  const effectiveTextImportDifficulty = useMemo<ImportDifficulty>(() => {
    return quizId ? quizForcedDifficulty : textImportDefaultDifficulty;
  }, [quizForcedDifficulty, quizId, textImportDefaultDifficulty]);

  const { register, handleSubmit, formState: { errors }, setValue } = useForm<QuizFormData>({
    resolver: zodResolver(quizSchema),
    defaultValues: {
      title: '',
      description: '',
      xp_reward: 10,
      quiz_specialties: [],
      chas_dimension: 'C',
    },
  });

  // Prefill from Forum Insights draft (if any)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('studio_compendium_draft');
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || draft.kind !== 'quiz') return;
      if (draft.title) setValue('title', String(draft.title).replace(/^Quiz:\s*/i,'').trim());
      if (draft.summary) setValue('description', String(draft.summary));
      if (Array.isArray(draft.specialties)) setValue('quiz_specialties', draft.specialties);
      if (draft.chas && ['C','H','A','S'].includes(draft.chas)) setValue('chas_dimension', draft.chas);
      // Default XP header suggestion (can be adjusted by user)
      setValue('xp_reward', 20);
      // Clear so it won't prefill again unexpectedly
      localStorage.removeItem('studio_compendium_draft');
    } catch {
      void 0;
    }
  }, [setValue]);

  // Load StudyLab sources (best-effort; table may be absent in older DBs)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const columnsV2 = 'id,title,kind,url,summary,ingest_status,created_at';
        const columnsV1 = 'id,title,kind,url,summary,created_at';
        let res = await supabase
          .from('study_sources')
          .select(columnsV2)
          .order('created_at', { ascending: false })
          .limit(80);
        if (res.error && /column .*ingest_status/i.test(String(res.error.message || res.error))) {
          res = await supabase
            .from('study_sources')
            .select(columnsV1)
            .order('created_at', { ascending: false })
            .limit(80);
        }
        if (cancelled) return;
        if (!res.error && Array.isArray(res.data)) {
          setStudySources(res.data as any[]);
        }
      } catch {
        if (!cancelled) setStudySources([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await supabase
          .from('study_source_questions')
          .select(
            'id, source_id, question_text, options, answer_index, explanation, difficulty, tags, created_at, study_sources(title, topic, category, access_count, last_used_at)',
          )
          .order('created_at', { ascending: false })
          .limit(200);
        if (res.error) throw res.error;
        if (!cancelled) setSuggestedQuestions(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (!cancelled) setSuggestedQuestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed from URL query (?seed_source=<id>)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const seed = String(params.get('seed_source') || '').trim();
    if (!seed) return;
    setBaseSourceId((prev) => (prev ? prev : seed));
    setSelectedSourceIds((prev) => (prev.includes(seed) ? prev : [seed, ...prev].slice(0, 12)));
  }, [location.search]);

  // Avoid importing a stale preview after editing the text.
  useEffect(() => {
    setTextImportPreview(null);
    setTextImportIssues([]);
    setTextImportDrafts(null);
    setTextImportUsedAi(null);
  }, [textImport]);

  const parseTextImportPreview = async (opts?: { silent?: boolean }) => {
    const raw = String(textImport || '').trim();
    if (!raw) {
      if (!opts?.silent) toast.error('Cole o texto das perguntas antes de pré-visualizar.');
      return [];
    }
    setTextImportParsing(true);
    try {
      const inferredMax = inferQuestionCountFromText(raw);
      const resp = await apiFetch('/api/ai?handler=parse-quiz-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: raw,
          language: localeToOpenAiLanguageTag(getActiveLocale()),
          maxQuestions: inferredMax || 50,
          defaultDifficulty: textImportDefaultDifficulty,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(String(json?.error || 'Falha ao interpretar texto'));
      const questions = Array.isArray((json as any)?.questions) ? (json as any).questions : [];
      const issues = Array.isArray((json as any)?.issues) ? (json as any).issues : [];
      setTextImportPreview(questions);
      setTextImportIssues(issues);
      setTextImportUsedAi(Boolean((json as any)?.meta?.usedAi));

      const normalizePreviewToDrafts = (qs: any[]): ImportQuestionDraft[] => {
        const out: ImportQuestionDraft[] = [];
        for (const q of Array.isArray(qs) ? qs : []) {
          const question_text = String(q?.question_text || '').trim();
          if (question_text.length < 10) continue;
          const rawOpts = Array.isArray(q?.options) ? q.options : [];
          const options: ImportOptionDraft[] = rawOpts
            .map((o: any) => ({
              text: String(o?.text || o?.option_text || '').trim(),
              is_correct: Boolean(o?.is_correct),
              explanation: String(o?.explanation || '').trim(),
            }))
            .filter((o: any) => o.text.length > 0)
            .slice(0, 4);
          if (options.length !== 4) continue;
          const correctCount = options.filter((o) => o.is_correct).length;
          if (correctCount !== 1) continue;
          out.push({ question_text, difficulty_level: effectiveTextImportDifficulty, options, _meta: { aiImproved: false, regens: 0, edited: false } });
        }
        return out;
      };

      const drafts = normalizePreviewToDrafts(questions);
      setTextImportDrafts(drafts.length ? drafts : null);

      const isLowQuality = (s: string) =>
        /\b(procedimento semelhante|conceito relacionado|condi[cç][aã]o parcialmente|alternativa plaus[ií]vel)\b/i.test(String(s || '').trim());

      const shouldImprove = (d: ImportQuestionDraft) => {
        const wrongs = d.options.filter((o) => !o.is_correct);
        if (wrongs.length !== 3) return true;
        return wrongs.some((w) => isLowQuality(w.text));
      };

      const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

      const improveDrafts = async (items: ImportQuestionDraft[]) => {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return;
        // Only improve questions that look low-quality, unless user wants to force.
        const toImprove = list.some(shouldImprove);
        if (!textImportAutoImprove || !toImprove) return;
        setTextImportImproving(true);
        try {
          const payloadItems = list.map((d) => {
            const correct = d.options.find((o) => o.is_correct);
            return { question_text: d.question_text, correct_text: correct?.text || '' };
          });
          const resp2 = await apiFetch('/api/ai?handler=generate-wrongs-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: payloadItems,
              language: localeToOpenAiLanguageTag(getActiveLocale()),
              difficulty: effectiveTextImportDifficulty,
              count: 3,
              maxItems: 30,
            }),
          });
          const json2 = await resp2.json().catch(() => ({}));
          if (!resp2.ok) throw new Error(String((json2 as any)?.error || 'Falha ao gerar alternativas'));
          const results = Array.isArray((json2 as any)?.items) ? (json2 as any).items : [];
          setTextImportUsedAi(Boolean((json2 as any)?.meta?.usedAi) || Boolean((json as any)?.meta?.usedAi));

          const next = list.map((d, idx) => {
            const correct = d.options.find((o) => o.is_correct) || d.options[0];
            const wrongFromAi = Array.isArray(results?.[idx]?.wrong) ? results[idx].wrong : [];
            const wrong = wrongFromAi
              .map((w: any) => ({
                text: String(w?.text || '').trim(),
                is_correct: false,
                explanation: String(w?.explanation || '').trim(),
              }))
              .filter((w: any) => w.text.length > 0)
              .slice(0, 3);
            if (wrong.length !== 3) return d;
            const options = shuffle([{ ...correct, is_correct: true }, ...wrong]);
            return { ...d, difficulty_level: effectiveTextImportDifficulty, options, _meta: { ...(d._meta || {}), aiImproved: true } };
          });
          setTextImportDrafts(next);
        } catch (e: any) {
          // Keep drafts as-is; user can regenerate manually.
          console.warn('Text import: improveDrafts failed', e?.message || e);
        } finally {
          setTextImportImproving(false);
        }
      };

      // Auto-improve (best-effort) right after parsing.
      void improveDrafts(drafts);

      if (!opts?.silent) {
        const usedAi = Boolean((json as any)?.meta?.usedAi);
        toast.success(`Pré-visualização pronta: ${questions.length} pergunta(s)${usedAi ? ' (IA)' : ''}.`);
      }
      return questions;
    } catch (e: any) {
      setTextImportPreview(null);
      setTextImportIssues([]);
      if (!opts?.silent) toast.error(e?.message || 'Falha ao interpretar texto');
      return [];
    } finally {
      setTextImportParsing(false);
    }
  };

  const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

  const buildGlobalContextForAi = (drafts: ImportQuestionDraft[]) => {
    const lines = drafts
      .map((d, idx) => {
        const q = String(d.question_text || '').trim();
        const correct = d.options.find((o) => o.is_correct)?.text || '';
        if (!q || !correct) return null;
        return `- Q${idx + 1}: ${q.slice(0, 240)}\n  Correta: ${String(correct).trim().slice(0, 240)}`;
      })
      .filter(Boolean)
      .slice(0, 20);
    return lines.length ? lines.join('\n') : '';
  };

  const improveTextImportDrafts = async (opts?: { force?: boolean }) => {
    const list = Array.isArray(textImportDrafts) ? textImportDrafts : [];
    if (!list.length) return;
    setTextImportImproving(true);
    try {
      const payloadItems = list.map((d) => {
        const correct = d.options.find((o) => o.is_correct);
        return { question_text: d.question_text, correct_text: correct?.text || '' };
      });
      const resp = await apiFetch('/api/ai?handler=generate-wrongs-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: payloadItems,
          language: localeToOpenAiLanguageTag(getActiveLocale()),
          difficulty: effectiveTextImportDifficulty,
          count: 3,
          maxItems: 30,
          context: buildGlobalContextForAi(list),
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(String((json as any)?.error || 'Falha ao gerar alternativas'));
      const results = Array.isArray((json as any)?.items) ? (json as any).items : [];
      setTextImportUsedAi(Boolean((json as any)?.meta?.usedAi));

      const next = list.map((d, idx) => {
        const correct = d.options.find((o) => o.is_correct) || d.options[0];
        const wrongFromAi = Array.isArray(results?.[idx]?.wrong) ? results[idx].wrong : [];
        const wrong = wrongFromAi
          .map((w: any) => ({
            text: String(w?.text || '').trim(),
            is_correct: false,
            explanation: String(w?.explanation || '').trim(),
          }))
          .filter((w: any) => w.text.length > 0)
          .slice(0, 3);
        if (wrong.length !== 3) return d;
        const options = shuffle([{ ...correct, is_correct: true }, ...wrong]);
        return { ...d, difficulty_level: effectiveTextImportDifficulty, options, _meta: { ...(d._meta || {}), aiImproved: true } };
      });
      setTextImportDrafts(next);
      toast.success(`Alternativas atualizadas (IA): ${next.length} pergunta(s).`);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao melhorar alternativas');
    } finally {
      setTextImportImproving(false);
    }
  };

  const regenerateDraftWrongs = async (index: number) => {
    const idx = Number(index);
    const list = Array.isArray(textImportDrafts) ? [...textImportDrafts] : [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return;
    const d = list[idx];
    const correct = d.options.find((o) => o.is_correct) || d.options[0];
    const avoid = d.options.filter((o) => !o.is_correct).map((o) => o.text);
    try {
      const resp = await apiFetch('/api/ai?handler=generate-wrongs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: d.question_text,
          correct: correct.text,
          difficulty: effectiveTextImportDifficulty,
          language: localeToOpenAiLanguageTag(getActiveLocale()),
          count: 3,
          avoid,
          context: buildGlobalContextForAi(list),
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(String((json as any)?.error || 'Falha ao gerar alternativas'));
      const wrongFromAi = Array.isArray((json as any)?.wrong) ? (json as any).wrong : [];
      const wrong = wrongFromAi
        .map((w: any) => ({
          text: String(w?.text || '').trim(),
          is_correct: false,
          explanation: String(w?.explanation || '').trim(),
        }))
        .filter((w: any) => w.text.length > 0)
        .slice(0, 3);
      if (wrong.length !== 3) throw new Error('IA não retornou 3 alternativas');
      list[idx] = {
        ...d,
        difficulty_level: effectiveTextImportDifficulty,
        options: shuffle([{ ...correct, is_correct: true }, ...wrong]),
        _meta: { ...(d._meta || {}), aiImproved: true, regens: Number(d._meta?.regens || 0) + 1 },
      };
      setTextImportDrafts(list);
      setTextImportUsedAi(Boolean((json as any)?.meta?.usedAi) || textImportUsedAi);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao regenerar alternativas');
    }
  };

  const updateDraft = (index: number, updater: (d: ImportQuestionDraft) => ImportQuestionDraft) => {
    setTextImportDrafts((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      if (index < 0 || index >= list.length) return prev;
      const next = updater(list[index]);
      list[index] = next;
      return list;
    });
  };

  const setDraftCorrectIndex = (qIndex: number, optIndex: number) => {
    updateDraft(qIndex, (d) => {
      const options = d.options.map((o, idx) => ({ ...o, is_correct: idx === optIndex }));
      return { ...d, options, _meta: { ...(d._meta || {}), edited: true } };
    });
  };

  const setDraftOptionText = (qIndex: number, optIndex: number, value: string) => {
    updateDraft(qIndex, (d) => {
      const options = d.options.map((o, idx) => (idx === optIndex ? { ...o, text: value } : o));
      return { ...d, options, _meta: { ...(d._meta || {}), edited: true } };
    });
  };

  const setDraftOptionExplanation = (qIndex: number, optIndex: number, value: string) => {
    updateDraft(qIndex, (d) => {
      const options = d.options.map((o, idx) => (idx === optIndex ? { ...o, explanation: value } : o));
      return { ...d, options, _meta: { ...(d._meta || {}), edited: true } };
    });
  };

  const setDraftQuestionText = (qIndex: number, value: string) => {
    updateDraft(qIndex, (d) => ({ ...d, question_text: value, _meta: { ...(d._meta || {}), edited: true } }));
  };

  const importTextQuestionsToQuiz = async (targetQuizId: string) => {
    const id = String(targetQuizId || '').trim();
    if (!id) return { ok: false, inserted: 0, failed: 0 };
    const raw = String(textImport || '').trim();
    if (!raw) {
      toast.error('Cole o texto das perguntas antes de importar.');
      return { ok: false, inserted: 0, failed: 0 };
    }

    setTextImportImporting(true);
    try {
      // Force XP per question based on the quiz setting (xp_reward).
      let forcedDifficulty: 'basico' | 'intermediario' | 'avancado' | 'especialista' = textImportDefaultDifficulty;
      try {
        const { data: ch } = await supabase.from('challenges').select('xp_reward').eq('id', id).maybeSingle();
        const xpReward = Number((ch as any)?.xp_reward);
        if ([5, 10, 20, 50].includes(xpReward)) forcedDifficulty = xpToDifficulty(xpReward);
      } catch {
        // ignore
      }

      const questions = (Array.isArray(textImportPreview) && textImportPreview.length)
        ? textImportPreview
        : await parseTextImportPreview({ silent: true });

      if (!questions.length) throw new Error('Nenhuma pergunta válida foi encontrada no texto.');

      const lowQualityRe = /\b(procedimento semelhante|conceito relacionado|condi[cç][aã]o parcialmente|alternativa plaus[ií]vel)\b/i;
      const normalizeToDrafts = (qs: any[]): ImportQuestionDraft[] => {
        const out: ImportQuestionDraft[] = [];
        for (const q of Array.isArray(qs) ? qs : []) {
          const question_text = String(q?.question_text || '').trim();
          if (question_text.length < 10) continue;
          const rawOpts = Array.isArray(q?.options) ? q.options : [];
          const options: ImportOptionDraft[] = rawOpts
            .map((o: any) => ({
              text: String(o?.text || o?.option_text || '').trim(),
              is_correct: Boolean(o?.is_correct),
              explanation: String(o?.explanation || '').trim(),
            }))
            .filter((o: any) => o.text.length > 0)
            .slice(0, 4);
          if (options.length !== 4) continue;
          const correctCount = options.filter((o) => o.is_correct).length;
          if (correctCount !== 1) continue;
          out.push({ question_text, difficulty_level: forcedDifficulty, options, _meta: { aiImproved: false, regens: 0, edited: false } });
        }
        return out;
      };

      let drafts: ImportQuestionDraft[] = Array.isArray(textImportDrafts) && textImportDrafts.length
        ? textImportDrafts.map((d) => ({ ...d, difficulty_level: forcedDifficulty }))
        : normalizeToDrafts(questions);

      if (!drafts.length) throw new Error('Não consegui montar perguntas válidas (precisa de 4 alternativas e 1 correta).');

      // Improve low-quality wrong options before inserting (best-effort).
      if (textImportAutoImprove) {
        const needs = drafts.some((d) => d.options.filter((o) => !o.is_correct).some((w) => lowQualityRe.test(w.text)));
        if (needs) {
          try {
            const payloadItems = drafts.map((d) => {
              const correct = d.options.find((o) => o.is_correct);
              return { question_text: d.question_text, correct_text: correct?.text || '' };
            });
            const resp2 = await apiFetch('/api/ai?handler=generate-wrongs-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: payloadItems,
                language: localeToOpenAiLanguageTag(getActiveLocale()),
                difficulty: forcedDifficulty,
                count: 3,
                maxItems: 30,
                context: buildGlobalContextForAi(drafts),
              }),
            });
            const json2 = await resp2.json().catch(() => ({}));
            if (resp2.ok) {
              const results = Array.isArray((json2 as any)?.items) ? (json2 as any).items : [];
              drafts = drafts.map((d, idx) => {
                const correct = d.options.find((o) => o.is_correct) || d.options[0];
                const wrongFromAi = Array.isArray(results?.[idx]?.wrong) ? results[idx].wrong : [];
                const wrong = wrongFromAi
                  .map((w: any) => ({
                    text: String(w?.text || '').trim(),
                    is_correct: false,
                    explanation: String(w?.explanation || '').trim(),
                  }))
                  .filter((w: any) => w.text.length > 0)
                  .slice(0, 3);
                if (wrong.length !== 3) return d;
                return { ...d, options: shuffle([{ ...correct, is_correct: true }, ...wrong]), _meta: { ...(d._meta || {}), aiImproved: true } };
              });
              setTextImportDrafts(drafts);
              setTextImportUsedAi(Boolean((json2 as any)?.meta?.usedAi));
            }
          } catch {
            // ignore
          }
        }
      }

      let inserted = 0;
      let failed = 0;
      for (let i = 0; i < drafts.length; i += 1) {
        const q = drafts[i] || {};
        try {
          const resp = await apiFetch('/api/admin?handler=studio-create-quiz-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              challengeId: id,
              question_text: String(q?.question_text || '').trim(),
              difficulty_level: forcedDifficulty,
              options: Array.isArray(q?.options)
                ? q.options.map((o: any) => ({
                    option_text: String(o?.text || o?.option_text || '').trim(),
                    is_correct: Boolean(o?.is_correct),
                    explanation: String(o?.explanation || '').trim(),
                  }))
                : [],
            }),
          });
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(String(json?.error || 'Falha ao inserir pergunta'));
          inserted += 1;
        } catch (e: any) {
          failed += 1;
          console.warn('Falha ao importar pergunta', { index: i, error: e?.message || e });
        }
      }

      setRefreshKey((prev) => prev + 1);
      toast.success(`Importação concluída: ${inserted} inserida(s)${failed ? ` • ${failed} falharam` : ''}.`);

      // Best-effort metrics to evaluate adherence (audit_log)
      try {
        const metaList = Array.isArray(drafts) ? drafts : [];
        const metrics = {
          source: 'paste_text',
          total: metaList.length,
          inserted,
          failed,
          usedAi: textImportUsedAi,
          aiImproved: metaList.filter((d) => Boolean(d?._meta?.aiImproved)).length,
          edited: metaList.filter((d) => Boolean(d?._meta?.edited)).length,
          regens: metaList.reduce((sum, d) => sum + (Number(d?._meta?.regens || 0) || 0), 0),
          difficulty: forcedDifficulty,
          locale: getActiveLocale(),
        };
        await apiFetch('/api/admin?handler=studio-log-quiz-import-metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeId: id, metrics }),
        });
      } catch {
        // ignore
      }

      return { ok: inserted > 0, inserted, failed };
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao importar perguntas');
      return { ok: false, inserted: 0, failed: 0 };
    } finally {
      setTextImportImporting(false);
    }
  };

  const onSubmit = async (data: QuizFormData) => {
    setIsSubmitting(true);
    try {
      // Prefer backend flow (RBAC + owner_id + workflow status)
      try {
        const resp = await apiFetch("/api/admin?handler=curation-create-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.title,
            description: data.description,
            xp_reward: data.xp_reward,
            quiz_specialties: data.quiz_specialties || null,
            chas_dimension: data.chas_dimension || "C",
          }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(String(json?.error || "Erro ao criar quiz"));
        const created = (json as any)?.quiz;
        if (!created?.id) throw new Error("Resposta inesperada ao criar quiz");
        setQuizMeta({ title: data.title, description: data.description || '' });
        setQuizXpReward(Number(data.xp_reward) || 10);
        setQuizId(created.id);
        if (textImportAuto && String(textImport || '').trim()) {
          await importTextQuestionsToQuiz(created.id);
        } else {
          toast.success("Quiz criado! Agora adicione as perguntas.");
        }
        return;
      } catch (e) {
        console.warn("curation-create-quiz failed; falling back to direct insert", e);
      }

      // Fallback (compat): create directly via client if backend handler not available
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      let challenge = null as any;
      const baseInsert: any = {
        title: data.title,
        description: data.description,
        type: "quiz",
        xp_reward: data.xp_reward,
        evidence_required: false,
        require_two_leader_eval: false,
      };
      const withWorkflow: any = {
        ...baseInsert,
        owner_id: user.id,
        created_by: user.id,
        quiz_workflow_status: "DRAFT",
        quiz_specialties: data.quiz_specialties || null,
        chas_dimension: data.chas_dimension || "C",
      };

      const { data: ch1, error: err1 } = await supabase.from("challenges").insert(withWorkflow).select().single();
      if (err1) {
        const { data: ch2, error: err2 } = await supabase.from("challenges").insert(baseInsert).select().single();
        if (err2) throw err2;
        challenge = ch2;
      } else {
        challenge = ch1;
      }

      setQuizId(challenge.id);
      setQuizMeta({ title: data.title, description: data.description || '' });
      setQuizXpReward(Number(data.xp_reward) || 10);
      if (textImportAuto && String(textImport || '').trim()) {
        await importTextQuestionsToQuiz(challenge.id);
      } else {
        toast.success("Quiz criado! Agora adicione as perguntas.");
      }
    } catch (error) {
      console.error("Error creating quiz:", error);
      toast.error("Erro ao criar quiz");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuestionAdded = () => {
    setRefreshKey(prev => prev + 1);
  };

  const applyBaseSource = () => {
    if (!baseSourceId) return;
    const src = studySources.find((s: any) => String(s.id) === String(baseSourceId));
    if (!src) {
      toast.error('Fonte do StudyLab não encontrada.');
      return;
    }
    const title = String(src.title || '').trim();
    const summary = String(src.summary || '').trim();
    const url = String(src.url || '').trim();
    if (title) {
      setValue('title', `Quiz: ${title}`.replace(/^Quiz:\s*/i, 'Quiz: '), { shouldValidate: true, shouldDirty: true });
    }
    if (summary || url) {
      setValue('description', (summary || url).slice(0, 1200), { shouldValidate: true, shouldDirty: true });
    }
    setSelectedSourceIds((prev) => (prev.includes(String(src.id)) ? prev : [String(src.id), ...prev].slice(0, 12)));
    toast.success('Base do StudyLab aplicada ao quiz.');
  };

  const filteredSuggestedQuestions = useMemo(() => {
    const q = questionSearch.trim().toLowerCase();
    const list = suggestedQuestions.filter((item) => {
      const source = item?.study_sources || {};
      const text = [
        item?.question_text || "",
        source?.title || "",
        source?.topic || "",
        source?.category || "",
        Array.isArray(item?.tags) ? item.tags.join(" ") : "",
      ]
        .join(" ")
        .toLowerCase();
      if (questionCategory !== "ALL" && String(source?.category || "").toUpperCase() !== questionCategory) {
        return false;
      }
      if (q && !text.includes(q)) return false;
      return true;
    });

    const score = (item: any) => {
      const source = item?.study_sources || {};
      const access = Number(source?.access_count || 0) || 0;
      const createdAt = Date.parse(String(item?.created_at || "")) || 0;
      const recency = createdAt ? Math.max(0, 30 - (Date.now() - createdAt) / (1000 * 60 * 60 * 24)) : 0;
      return access * 2 + recency;
    };

    const sorted = [...list];
    if (questionSort === "access") {
      sorted.sort((a, b) => (Number(b?.study_sources?.access_count || 0) || 0) - (Number(a?.study_sources?.access_count || 0) || 0));
    } else if (questionSort === "relevance") {
      sorted.sort((a, b) => score(b) - score(a));
    } else {
      sorted.sort((a, b) => String(b?.created_at || "").localeCompare(String(a?.created_at || "")));
    }
    return sorted.slice(0, 80);
  }, [suggestedQuestions, questionSearch, questionCategory, questionSort]);

  const handleAddSuggestedQuestion = async (item: any) => {
    if (!quizId) {
      toast.error('Crie o quiz primeiro para adicionar perguntas.');
      return;
    }
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Não autenticado');

      const optionsRaw = Array.isArray(item?.options) ? item.options : [];
      const options = optionsRaw
        .map((opt: any, idx: number) => ({
          option_text: String(opt?.text || opt?.option_text || opt?.option || "").trim(),
          is_correct: Boolean(opt?.is_correct) || idx === Number(item?.answer_index || -1),
          explanation: String(opt?.explanation || item?.explanation || "").trim(),
        }))
        .filter((opt: any) => opt.option_text.length >= 2);
      if (!options.length) throw new Error('Pergunta sem alternativas válidas.');
      if (!options.some((opt: any) => opt.is_correct)) options[0].is_correct = true;

      const resp = await apiFetch('/api/admin?handler=studio-create-quiz-question', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          challengeId: quizId,
          question_text: String(item?.question_text || '').trim(),
          difficulty_level: quizForcedDifficulty,
          options,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao adicionar pergunta');
      toast.success('Pergunta adicionada ao quiz.');
      setRefreshKey((prev) => prev + 1);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao adicionar pergunta');
    }
  };

  const handleGenerateFromStudyLab = async () => {
    if (!quizId) return;
    const sourceIds = Array.from(new Set(selectedSourceIds)).filter(Boolean).slice(0, 12);
    if (!sourceIds.length) {
      toast.error('Selecione ao menos 1 fonte do StudyLab.');
      return;
    }

    const count = Math.max(3, Math.min(20, Number(autoQuestionCount || 10)));
    setAutoGenerating(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Não autenticado');

      const resp = await apiFetch('/api/ai?handler=study-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mode: 'standard',
          language: localeToOpenAiLanguageTag(getActiveLocale()),
          topic: quizMeta.title,
          context: quizMeta.description,
          question_count: count,
          source_ids: sourceIds,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao gerar perguntas');
      const payload = (json as any)?.quiz || json;
      const questions = Array.isArray((payload as any)?.questions)
        ? (payload as any).questions
        : Array.isArray((payload as any)?.questoes)
          ? (payload as any).questoes
          : [];
      if (!questions.length) throw new Error('A IA não retornou perguntas.');

      let ok = 0;
      let skipped = 0;
      for (const q of questions) {
        const questionText = String(q?.question_text || q?.enunciado || '').trim();
        const optionsObj = q?.options || q?.alternativas || {};
        const correctLetter = String(q?.correct_letter || q?.correta || '').trim().toUpperCase();
        const explanation = String(q?.explanation || '').trim();
        if (!questionText || !optionsObj || typeof optionsObj !== 'object') {
          skipped++;
          continue;
        }

        const letters = ['A', 'B', 'C', 'D'] as const;
        const options = letters
          .map((L) => ({
            option_text: String((optionsObj as any)[L] || '').trim(),
            is_correct: L === correctLetter,
            explanation: L === correctLetter ? explanation : '',
          }))
          .filter((o) => o.option_text.length > 0);

        // Require at least 4 options and a correct one
        if (options.length < 4 || !options.some((o) => o.is_correct)) {
          skipped++;
          continue;
        }

        const create = await apiFetch('/api/admin?handler=studio-create-quiz-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            challengeId: quizId,
            question_text: questionText,
            difficulty_level: quizForcedDifficulty,
            options,
            ...(autoProofread ? {} : { skip_proofread: true }),
          }),
        });
        const createdJson = await create.json().catch(() => ({}));
        if (!create.ok) {
          throw new Error(createdJson?.error || 'Falha ao inserir pergunta no quiz');
        }
        ok++;
      }

      handleQuestionAdded();
      toast.success(`Perguntas inseridas: ${ok}${skipped ? ` • ignoradas: ${skipped}` : ''}`);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao gerar perguntas');
    } finally {
      setAutoGenerating(false);
    }
  };

  const submitForCuration = async () => {
    if (!quizId) return;
    setIsSubmittingForCuration(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Não autenticado');
      const resp = await apiFetch('/api/admin?handler=curation-submit-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ challengeId: quizId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao submeter');
      toast.success('Quiz submetido para curadoria');
      navigate('/studio/curadoria');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao submeter');
    } finally {
      setIsSubmittingForCuration(false);
    }
  };

  // Hydrate XP reward from DB for existing quizzes (robust across reloads).
  useEffect(() => {
    if (!quizId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from('challenges').select('xp_reward').eq('id', quizId).maybeSingle();
        const xp = Number((data as any)?.xp_reward);
        if (cancelled) return;
        if (Number.isFinite(xp)) setQuizXpReward(xp);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  if (!quizId) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-6 w-6 text-primary" />
            Criar Quiz de Conhecimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CompendiumPicker
            open={compOpen}
            onOpenChange={setCompOpen}
            onPick={(item) => {
              const cat = item.final?.catalog || item.final || item.catalog || {};
              const title = String(cat.title || 'Ocorrência');
              const summary = String(cat.summary || '').trim();
              const tags = Array.isArray(cat.keywords) ? cat.keywords : [];
              const failure = String(cat.failure_mode || '').trim();
              const root = String(cat.root_cause || '').trim();
              setValue('title', `Quiz: ${title}`.replace(/^Quiz:\s*/i, 'Quiz: '), { shouldValidate: true, shouldDirty: true });
              const body = [
                summary,
                failure ? `Modo de falha: ${failure}` : '',
                root ? `Causa raiz: ${root}` : '',
                tags.length ? `Palavras-chave: ${tags.join(', ')}` : '',
              ]
                .filter((v) => v && String(v).trim().length > 0)
                .join('\n');
              setValue('description', body, { shouldValidate: true, shouldDirty: true });
            }}
            title="Buscar ocorrência para base do quiz"
            description="Selecionar um relatório do Compêndio para pré-preencher título e contexto do quiz"
          />
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="title">Título do Quiz</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setCompOpen(true)}>
                  Buscar no Compêndio
                </Button>
              </div>
              <Input
                id="title"
                {...register('title')}
                placeholder="Ex: Conhecimentos de Segurança"
              />
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="description">Descrição (opcional)</Label>
                <span className="text-xs text-muted-foreground">Use para contextualizar o quiz</span>
              </div>
              <Textarea
                id="description"
                {...register('description')}
                placeholder="Descreva o objetivo do quiz..."
                rows={3}
              />
              {errors.description && (
                <p className="text-sm text-destructive">{errors.description.message}</p>
              )}
              {!errors.description && (
                <p className="text-xs text-muted-foreground">
                  Deixe em branco ou use pelo menos 10 caracteres.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>XP por Pergunta</Label>
              <Select onValueChange={(v:any)=> setValue('xp_reward', Number(v), { shouldValidate: true, shouldDirty: true })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione 5 / 10 / 20 / 50" />
                </SelectTrigger>
                <SelectContent>
                  {[5,10,20,50].map(x => (<SelectItem key={x} value={String(x)}>{x} XP</SelectItem>))}
                </SelectContent>
              </Select>
              <Input id="xp_reward" type="number" {...register('xp_reward')} placeholder="5" className="sr-only" />
              {errors.xp_reward && (<p className="text-sm text-destructive">{errors.xp_reward.message}</p>)}
              <p className="text-xs text-muted-foreground">
                Este valor define o XP de cada pergunta do quiz (a dificuldade é ajustada automaticamente para bater 5/10/20/50).
              </p>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-muted/10 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Importar perguntas por texto (IA)</p>
                  <p className="text-[11px] text-muted-foreground">
                    Cole perguntas em linguagem natural. Você pode colar (A-D + “Correta: B”), ou “Pergunta + Resposta correta”, ou ainda um bullet único com a resposta correta (ex.: “- …”).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Importar ao criar</span>
                  <Switch checked={textImportAuto} onCheckedChange={(v) => setTextImportAuto(Boolean(v))} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Dificuldade padrão</Label>
                  <Select value={textImportDefaultDifficulty} onValueChange={(v: any) => setTextImportDefaultDifficulty(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Intermediário" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basico">Básico</SelectItem>
                      <SelectItem value="intermediario">Intermediário</SelectItem>
                      <SelectItem value="avancado">Avançado</SelectItem>
                      <SelectItem value="especialista">Especialista</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ações</Label>
                  <Button type="button" variant="outline" disabled={textImportParsing || !String(textImport || '').trim()} onClick={() => void parseTextImportPreview()}>
                    {textImportParsing ? 'Analisando…' : 'Pré-visualizar'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Texto</Label>
                <Textarea
                  value={textImport}
                  onChange={(e) => setTextImport(e.target.value)}
                  placeholder={`Pergunta 1: ...?\nResposta correta: ...\n\nPergunta 2: ...?\nA) ...\nB) ...\nC) ...\nD) ...\nCorreta: B`}
                  rows={8}
                />
                <p className="text-[11px] text-muted-foreground">
                  Dica: se você usar A-D, marque a correta (ex.: “Correta: B”). Se você colar só a resposta correta, a IA cria as erradas.
                </p>
              </div>

              {Array.isArray(textImportPreview) ? (
                <div className="space-y-2">
                  <div className="text-[12px]">
                    <span className="font-medium">Pré-visualização:</span> {textImportPreview.length} pergunta(s)
                    {textImportIssues.length ? (
                      <span className="text-muted-foreground"> • {textImportIssues.length} aviso(s)</span>
                    ) : null}
                  </div>
                  {textImportIssues.length ? (
                    <div className="text-[11px] text-muted-foreground">
                      {textImportIssues.slice(0, 6).map((m, idx) => (<div key={`issue-${idx}`}>- {m}</div>))}
                      {textImportIssues.length > 6 ? <div>…</div> : null}
                    </div>
                  ) : null}
                  <Accordion type="single" collapsible>
                    <AccordionItem value="preview">
                      <AccordionTrigger className="text-[12px]">Ver perguntas</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          {textImportPreview.slice(0, 10).map((q: any, idx: number) => (
                            <div key={`qprev-${idx}`} className="rounded-md border p-2 bg-background/40">
                              <div className="text-[12px] font-medium">Q{idx + 1}</div>
                              <div className="text-[12px] text-muted-foreground whitespace-pre-wrap">{String(q?.question_text || '').trim()}</div>
                            </div>
                          ))}
                          {textImportPreview.length > 10 ? (
                            <div className="text-[11px] text-muted-foreground">Mostrando 10 de {textImportPreview.length}.</div>
                          ) : null}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              ) : null}
            </div>

            <Accordion type="single" collapsible>
              <AccordionItem value="advanced">
                <AccordionTrigger>Avançado (opcional)</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-2">
                    <div className="rounded-lg border border-dashed border-border bg-muted/10 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">Base do StudyLab</p>
                          <p className="text-[11px] text-muted-foreground">
                            Selecione um material que você subiu (URL PDF, arquivo, etc.) para pré-preencher e usar como base na geração de perguntas.
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" disabled={!baseSourceId} onClick={applyBaseSource}>
                          Aplicar
                        </Button>
                      </div>

                      <Select value={baseSourceId} onValueChange={setBaseSourceId}>
                        <SelectTrigger>
                          <SelectValue placeholder={studySources.length ? "Selecionar fonte do StudyLab" : "Nenhuma fonte disponível"} />
                        </SelectTrigger>
                        <SelectContent>
                          {studySources.map((s: any) => (
                            <SelectItem key={s.id} value={s.id}>
                              {String(s.title || '').trim() || 'Fonte sem título'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Especialidades Relacionadas</Label>
                      <div className="grid sm:grid-cols-2 gap-2 text-sm">
                        {[
                          { id: 'seguranca', label: 'Segurança' },
                          { id: 'protecao_automacao', label: 'Proteção & Automação' },
                          { id: 'telecom', label: 'Telecom' },
                          { id: 'equipamentos_manobras', label: 'Equipamentos & Manobras' },
                          { id: 'instrumentacao', label: 'Instrumentação' },
                          { id: 'gerais', label: 'Gerais' },
                        ].map((s) => (
                          <label key={s.id} className="inline-flex items-center gap-2">
                            <input type="checkbox" value={s.id} {...register('quiz_specialties')} />
                            <span>{s.label}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Essas tags ajudam a classificar e buscar quizzes por domínio.</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Dimensão CHAS</Label>
                      <select className="w-full h-9 rounded-md bg-transparent border px-2" {...register('chas_dimension')}>
                        <option value="C">C — Conhecimento</option>
                        <option value="H">H — Habilidade</option>
                        <option value="A">A — Atitude</option>
                        <option value="S">S — Segurança</option>
                      </select>
                      {errors.chas_dimension && <p className="text-sm text-destructive">Dimensão inválida</p>}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <Button type="submit" disabled={isSubmitting} className="w-full" size="lg">
              {isSubmitting ? "Criando..." : "Criar Quiz e Adicionar Perguntas"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-6 w-6 text-primary" />
            Adicionar Perguntas ao Quiz
          </CardTitle>
          <CardDescription className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div>Quando terminar, submeta para curadoria.</div>
              <div className="text-[11px] text-muted-foreground">
                XP por pergunta: {quizXpReward ?? '—'} • Dificuldade: {quizForcedDifficulty === 'basico' ? 'Básico' : quizForcedDifficulty === 'intermediario' ? 'Intermediário' : quizForcedDifficulty === 'avancado' ? 'Avançado' : 'Especialista'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => navigate('/studio/curadoria')}>
                Abrir Hub de Curadoria
              </Button>
              <Button onClick={submitForCuration} disabled={isSubmittingForCuration}>
                {isSubmittingForCuration ? 'Submetendo…' : 'Submeter'}
              </Button>
            </div>
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-primary/10">
        <CardHeader>
          <CardTitle>Adicionar perguntas</CardTitle>
          <CardDescription>
            Crie uma pergunta por vez (IA), cole várias de uma vez (texto), gere via StudyLab, use sugestões, ou abra o fluxo do Milhão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="single" className="w-full">
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="single">Uma questão (IA)</TabsTrigger>
              <TabsTrigger value="paste">Colar várias</TabsTrigger>
              <TabsTrigger value="milhao">Milhão</TabsTrigger>
              <TabsTrigger value="studylab">StudyLab</TabsTrigger>
              <TabsTrigger value="suggestions">Sugestões</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="mt-4">
              <QuizQuestionForm challengeId={quizId} onQuestionAdded={handleQuestionAdded} />
            </TabsContent>

            <TabsContent value="paste" className="mt-4">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Cole perguntas (com A-D ou só a resposta correta). Para “Questão 1 … - resposta correta”, o sistema mantém a quantidade e cria 3 erradas.
                </p>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="w-full sm:w-60 space-y-2">
                    <Label>Dificuldade padrão</Label>
                    <Select value={textImportDefaultDifficulty} onValueChange={(v: any) => setTextImportDefaultDifficulty(v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Intermediário" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="basico">Básico</SelectItem>
                        <SelectItem value="intermediario">Intermediário</SelectItem>
                        <SelectItem value="avancado">Avançado</SelectItem>
                        <SelectItem value="especialista">Especialista</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/10">
                      <span className="text-[11px] text-muted-foreground">Melhorar erradas (IA)</span>
                      <Switch checked={textImportAutoImprove} onCheckedChange={(v) => setTextImportAutoImprove(Boolean(v))} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={textImportParsing || !String(textImport || '').trim()}
                      onClick={() => void parseTextImportPreview()}
                    >
                      {textImportParsing ? 'Analisando…' : 'Pré-visualizar'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={textImportImproving || !Array.isArray(textImportDrafts) || textImportDrafts.length === 0}
                      onClick={() => void improveTextImportDrafts({ force: true })}
                    >
                      {textImportImproving ? 'Melhorando…' : 'Melhorar alternativas'}
                    </Button>
                    <Button
                      type="button"
                      disabled={textImportImporting || textImportParsing || !String(textImport || '').trim()}
                      onClick={() => void importTextQuestionsToQuiz(quizId as string)}
                    >
                      {textImportImporting ? 'Importando…' : 'Importar neste quiz'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Texto</Label>
                  <Textarea
                    value={textImport}
                    onChange={(e) => setTextImport(e.target.value)}
                    placeholder={`Questão 1\n...\n\n- resposta correta\n\nQuestão 2\n...\n\n- resposta correta\n\n(ou)\n\nPergunta 1: ...?\nResposta correta: ...\n\nPergunta 2: ...?\nA) ...\nB) ...\nC) ...\nD) ...\nCorreta: B`}
                    rows={10}
                  />
                </div>

                {Array.isArray(textImportPreview) ? (
                  <div className="space-y-2">
                    <div className="text-[12px]">
                      <span className="font-medium">Pré-visualização:</span> {textImportPreview.length} pergunta(s)
                      {textImportIssues.length ? (
                        <span className="text-muted-foreground"> • {textImportIssues.length} aviso(s)</span>
                      ) : null}
                      {textImportUsedAi != null ? (
                        <span className="text-muted-foreground"> • {textImportUsedAi ? 'IA' : 'heurístico'}</span>
                      ) : null}
                    </div>
                    {textImportIssues.length ? (
                      <div className="text-[11px] text-muted-foreground">
                        {textImportIssues.slice(0, 6).map((m, idx) => (<div key={`issue2-${idx}`}>- {m}</div>))}
                        {textImportIssues.length > 6 ? <div>…</div> : null}
                      </div>
                    ) : null}
                    {Array.isArray(textImportDrafts) && textImportDrafts.length ? (
                      <Accordion type="single" collapsible>
                        {textImportDrafts.slice(0, 20).map((d, idx) => {
                          const correctIdx = Math.max(0, d.options.findIndex((o) => o.is_correct));
                          const meta = d._meta || {};
                          return (
                            <AccordionItem key={`draft-${idx}`} value={`draft-${idx}`}>
                              <AccordionTrigger className="text-[12px]">
                                <span className="font-medium">Q{idx + 1}</span>
                                <span className="text-muted-foreground ml-2 truncate">{String(d.question_text || '').slice(0, 80)}</span>
                                {meta.aiImproved ? <span className="ml-2 text-[11px] text-muted-foreground">• IA</span> : null}
                                {meta.edited ? <span className="ml-2 text-[11px] text-muted-foreground">• editado</span> : null}
                                {meta.regens ? <span className="ml-2 text-[11px] text-muted-foreground">• regen {meta.regens}</span> : null}
                              </AccordionTrigger>
                              <AccordionContent>
                                <div className="space-y-3">
                                  <div className="space-y-1">
                                    <Label>Pergunta</Label>
                                    <Textarea
                                      value={d.question_text}
                                      onChange={(e) => setDraftQuestionText(idx, e.target.value)}
                                      rows={3}
                                    />
                                  </div>

                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <Label>Alternativas (marque a correta)</Label>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={textImportImproving}
                                      onClick={() => void regenerateDraftWrongs(idx)}
                                    >
                                      Regenerar erradas (IA)
                                    </Button>
                                  </div>

                                  <div className="space-y-2">
                                    {d.options.map((o, oidx) => (
                                      <div key={`opt-${idx}-${oidx}`} className="grid grid-cols-[20px_1fr] gap-2 items-start">
                                        <input
                                          type="radio"
                                          name={`correct-${idx}`}
                                          className="mt-2 accent-primary"
                                          checked={oidx === correctIdx}
                                          onChange={() => setDraftCorrectIndex(idx, oidx)}
                                        />
                                        <div className="space-y-2">
                                          <Input
                                            value={o.text}
                                            onChange={(e) => setDraftOptionText(idx, oidx, e.target.value)}
                                            placeholder={`Alternativa ${String.fromCharCode(65 + oidx)}`}
                                          />
                                          <Textarea
                                            value={o.explanation || ''}
                                            onChange={(e) => setDraftOptionExplanation(idx, oidx, e.target.value)}
                                            placeholder="Explicação (opcional)"
                                            rows={2}
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })}
                      </Accordion>
                    ) : (
                      <Accordion type="single" collapsible>
                        <AccordionItem value="preview2">
                          <AccordionTrigger className="text-[12px]">Ver perguntas (somente texto)</AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-2">
                              {textImportPreview.slice(0, 10).map((q: any, idx: number) => (
                                <div key={`qprev2-${idx}`} className="rounded-md border p-2 bg-background/40">
                                  <div className="text-[12px] font-medium">Q{idx + 1}</div>
                                  <div className="text-[12px] text-muted-foreground whitespace-pre-wrap">{String(q?.question_text || '').trim()}</div>
                                </div>
                              ))}
                              {textImportPreview.length > 10 ? (
                                <div className="text-[11px] text-muted-foreground">Mostrando 10 de {textImportPreview.length}.</div>
                              ) : null}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    )}
                    {Array.isArray(textImportDrafts) && textImportDrafts.length > 20 ? (
                      <div className="text-[11px] text-muted-foreground">Mostrando 20 de {textImportDrafts.length} para edição.</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="milhao" className="mt-4">
              <div className="rounded-lg border border-dashed border-border bg-muted/10 p-4 space-y-3">
                <p className="text-sm font-semibold">Quiz do Milhão (10 níveis)</p>
                <p className="text-sm text-muted-foreground">
                  Abra o gerador avançado para criar o Milhão completo (com progressão por nível) e inserir direto neste quiz.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => navigate(`/studio?module=ai-quiz&flow=milhao&targetQuizId=${encodeURIComponent(quizId)}`)}
                  >
                    Abrir gerador do Milhão
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(`/studio?module=ai-quiz&flow=multi&targetQuizId=${encodeURIComponent(quizId)}`)}
                  >
                    Abrir gerador (várias perguntas)
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="studylab" className="mt-4">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Use materiais enviados (ex.: manual em PDF via URL) como base. As perguntas são inseridas automaticamente neste quiz para revisão e curadoria.
                </p>

                <div className="space-y-2">
                  <Label>Buscar fonte</Label>
                  <Input value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} placeholder="Filtrar por título/URL…" />
                </div>

                <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
                  <p className="text-[11px] text-muted-foreground">Selecione uma ou mais fontes do StudyLab.</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-56 overflow-y-auto">
                    {studySources
                      .filter((s: any) => {
                        const q = sourceSearch.trim().toLowerCase();
                        if (!q) return true;
                        const hay = [s?.title, s?.url, s?.summary].filter(Boolean).join(" ").toLowerCase();
                        return hay.includes(q);
                      })
                      .map((s: any) => {
                        const checked = selectedSourceIds.includes(s.id);
                        const ingest = String(s.ingest_status || "").toLowerCase();
                        const ingestLabel = ingest === "pending" ? "analisando…" : ingest === "failed" ? "falhou" : "";
                        return (
                          <label
                            key={s.id}
                            className={`flex items-start gap-2 text-sm cursor-pointer rounded-md border px-3 py-2 transition ${
                              checked ? 'border-primary bg-primary/10 text-primary-foreground' : 'border-border bg-background'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="accent-primary mt-1"
                              checked={checked}
                              onChange={(e) => {
                                setSelectedSourceIds((prev) =>
                                  e.target.checked ? Array.from(new Set([...prev, s.id])) : prev.filter((id) => id !== s.id)
                                );
                              }}
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium line-clamp-2">{String(s.title || '').trim() || 'Fonte sem título'}</p>
                              <p className="text-[11px] text-muted-foreground line-clamp-1">
                                {s.kind ? String(s.kind).toUpperCase() : 'FONTE'}{ingestLabel ? ` • ${ingestLabel}` : ''}
                              </p>
                            </div>
                          </label>
                        );
                      })}

                    {studySources.length === 0 && (
                      <p className="text-xs text-muted-foreground col-span-full">
                        Nenhuma fonte encontrada. Envie materiais no StudyLab (URL ou arquivo) e tente novamente.
                      </p>
                    )}
                  </div>

                  {selectedSourceIds.length > 0 && (
                    <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setSelectedSourceIds([])}>
                      Limpar seleção ({selectedSourceIds.length})
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="space-y-2">
                    <Label>Quantidade</Label>
                    <Input
                      type="number"
                      min={3}
                      max={20}
                      value={autoQuestionCount}
                      onChange={(e) => setAutoQuestionCount(Number(e.target.value) || 10)}
                    />
                    <p className="text-[11px] text-muted-foreground">Sugestão: 5 a 15 perguntas por manual.</p>
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label>Revisão (PT-BR)</Label>
                    <div className="flex items-center justify-between rounded-md border border-border bg-background/50 px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">Corrigir escrita/acentos</p>
                      <Switch checked={autoProofread} onCheckedChange={setAutoProofread} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Desative para inglês/zh-CN ou para acelerar.</p>
                  </div>
                  <div className="md:col-span-1">
                    <Button
                      type="button"
                      className="w-full"
                      disabled={autoGenerating || selectedSourceIds.length === 0}
                      onClick={handleGenerateFromStudyLab}
                    >
                      {autoGenerating ? "Gerando e inserindo..." : "Gerar e inserir perguntas"}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="suggestions" className="mt-4">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Use perguntas sugeridas na catalogação para acelerar a criação. Filtre por tema, mais acessadas ou mais recentes.
                </p>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label>Buscar</Label>
                    <Input
                      value={questionSearch}
                      onChange={(e) => setQuestionSearch(e.target.value)}
                      placeholder="Buscar por pergunta, tema ou fonte..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Categoria</Label>
                    <Select value={questionCategory} onValueChange={(v) => setQuestionCategory(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STUDYLAB_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {STUDYLAB_CATEGORY_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Ordenar</Label>
                    <Select value={questionSort} onValueChange={(v) => setQuestionSort(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Mais recentes</SelectItem>
                        <SelectItem value="access">Mais acessadas</SelectItem>
                        <SelectItem value="relevance">Mais relevantes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {filteredSuggestedQuestions.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma sugestão encontrada. Envie materiais no StudyLab para gerar perguntas sugeridas.
                    </p>
                  )}
                  {filteredSuggestedQuestions.map((item: any) => {
                    const source = item?.study_sources || {};
                    const tags = Array.isArray(item?.tags) ? item.tags : [];
                    return (
                      <div key={item.id} className="rounded-md border border-border bg-background/60 p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-snug">{String(item?.question_text || '').trim()}</p>
                            <p className="text-[11px] text-muted-foreground">
                              Fonte: {String(source?.title || 'Sem título').slice(0, 80)}
                              {source?.category ? ` • ${source.category}` : ''}
                              {source?.topic ? ` • ${source.topic}` : ''}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {Array.isArray(item?.options) ? `${item.options.length} alternativas` : 'Alternativas geradas na curadoria'}
                            </p>
                          </div>
                          <Button type="button" size="sm" variant="outline" disabled={!quizId} onClick={() => handleAddSuggestedQuestion(item)}>
                            Adicionar
                          </Button>
                        </div>
                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {tags.slice(0, 8).map((t: string) => (
                              <span key={t} className="text-[10px] rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                                #{t}
                              </span>
                            ))}
                            {tags.length > 8 && (
                              <span className="text-[10px] rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                                +{tags.length - 8}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <QuizQuestionsList key={refreshKey} challengeId={quizId} onUpdate={handleQuestionAdded} />
    </div>
  );
}
