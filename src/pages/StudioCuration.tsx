import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import { ThemedBackground } from '@/components/ThemedBackground';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { QuizQuestionForm } from '@/components/QuizQuestionForm';
import { QuizQuestionsList } from '@/components/QuizQuestionsList';
import { TipDialogButton } from '@/components/TipDialogButton';

type QuizWorkflow = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PUBLISHED' | string;

type QuizListItem = {
  id: string;
  title: string;
  description: string | null;
  created_at: string | null;
  owner_id: string | null;
  created_by: string | null;
  quiz_workflow_status: QuizWorkflow | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  published_at: string | null;
  published_by: string | null;
};

type QuizComment = {
  id: string;
  kind: 'comment' | 'decision' | string;
  message: string;
  created_at: string;
  author_id: string | null;
};

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');

export default function StudioCuration() {
  const { user, userRole, isContentCurator } = useAuth();
  const nav = useNavigate();

  const isAdmin = userRole === 'admin' || userRole === 'gerente_djt';
  const canCurate = isContentCurator || isAdmin;

  const [tab, setTab] = useState(canCurate ? 'inbox' : 'my');
  const [loading, setLoading] = useState(true);
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => quizzes.find((q) => q.id === selectedId) || null, [quizzes, selectedId]);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [comments, setComments] = useState<QuizComment[]>([]);
  const [versions, setVersions] = useState<Array<{ id: string; version_number: number; created_at: string; created_by: string | null; reason: string | null }>>([]);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const [decisionNote, setDecisionNote] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const mine = !canCurate;
      const qs = new URLSearchParams();
      if (mine) qs.set('mine', 'true');
      if (canCurate && tab === 'inbox') qs.set('status', 'SUBMITTED');
      const resp = await apiFetch(`/api/admin?handler=curation-list-quizzes&${qs.toString()}`, { method: 'GET', cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar quizzes');
      setQuizzes(Array.isArray(json?.quizzes) ? json.quizzes : []);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao carregar quizzes');
      setQuizzes([]);
    } finally {
      setLoading(false);
    }
  }, [canCurate, tab]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const resp = await apiFetch(`/api/admin?handler=curation-get-quiz&id=${encodeURIComponent(id)}`, { method: 'GET', cache: 'no-store' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar quiz');
      setDetail(json);
      setEditTitle(String(json?.quiz?.title || ''));
      setEditDescription(String(json?.quiz?.description || ''));
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao carregar quiz');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const fetchComments = useCallback(async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('quiz_curation_comments')
        .select('id, kind, message, created_at, author_id')
        .eq('challenge_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setComments((data || []) as any);
    } catch {
      setComments([]);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (!selectedId) return;
    fetchDetail(selectedId);
    fetchComments(selectedId);
    (async () => {
      try {
        const resp = await apiFetch(`/api/admin?handler=curation-list-quiz-versions&challengeId=${encodeURIComponent(selectedId)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar versões');
        setVersions(Array.isArray(json?.versions) ? json.versions : []);
      } catch {
        setVersions([]);
      }
    })();
  }, [fetchComments, fetchDetail, selectedId]);

  const onCreateQuiz = async () => {
    try {
      const resp = await apiFetch('/api/admin?handler=curation-create-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Novo Quiz (rascunho)', description: '' }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao criar quiz');
      const id = json?.quiz?.id;
      await fetchList();
      if (id) setSelectedId(id);
      toast.success('Quiz criado');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao criar quiz');
    }
  };

  const onSaveMeta = async () => {
    if (!selectedId) return;
    try {
      const resp = await apiFetch('/api/admin?handler=curation-update-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: selectedId, title: editTitle, description: editDescription }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao salvar');
      toast.success('Dados salvos');
      await fetchList();
      await fetchDetail(selectedId);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao salvar');
    }
  };

  const onSubmitForCuration = async () => {
    if (!selectedId) return;
    try {
      const resp = await apiFetch('/api/admin?handler=curation-submit-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: selectedId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao submeter');
      toast.success('Quiz submetido');
      await fetchList();
      await fetchDetail(selectedId);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao submeter');
    }
  };

  const onReview = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!selectedId) return;
    try {
      const resp = await apiFetch('/api/admin?handler=curation-review-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: selectedId, decision, message: decisionNote }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha na revisão');
      toast.success(decision === 'APPROVED' ? 'Aprovado' : 'Reprovado');
      setDecisionNote('');
      await fetchList();
      await fetchDetail(selectedId);
      await fetchComments(selectedId);
    } catch (e: any) {
      toast.error(e?.message || 'Falha na revisão');
    }
  };

  const onPublish = async () => {
    if (!selectedId) return;
    try {
      const resp = await apiFetch('/api/admin?handler=curation-publish-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: selectedId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao publicar');
      toast.success('Publicado');
      await fetchList();
      await fetchDetail(selectedId);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao publicar');
    }
  };

  const workflow: QuizWorkflow = String(detail?.quiz?.quiz_workflow_status || selected?.quiz_workflow_status || 'PUBLISHED');
  const canEditDraft = workflow === 'DRAFT' || (workflow === 'REJECTED' && Boolean(detail?.isOwner));
  const canSeeAnswerKey = Boolean(detail?.isOwner || detail?.canCurate);
  const answerKey = useMemo(() => {
    const qs = Array.isArray(detail?.questions) ? detail.questions : [];
    return qs
      .map((q: any) => {
        const opts = Array.isArray(q?.options) ? q.options : [];
        const correct = opts.find((o: any) => Boolean(o?.is_correct));
        return {
          id: String(q?.id || ''),
          question_text: String(q?.question_text || ''),
          correct_text: correct ? String(correct?.option_text || '') : '',
          correct_explanation: correct ? String(correct?.explanation || '') : '',
        };
      })
      .filter((k: any) => k.id);
  }, [detail?.questions]);

  // --- Import pipeline (curator/admin only) ---
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importRow, setImportRow] = useState<any | null>(null);
  const [applyToQuizId, setApplyToQuizId] = useState<string>('');

  const draftQuizzes = useMemo(() => quizzes.filter((q) => String(q.quiz_workflow_status || 'PUBLISHED') === 'DRAFT'), [quizzes]);

  const runImport = async () => {
    if (!importFile || !user) return;
    setImportLoading(true);
    try {
      const userId = user.id;
      const safeName = String(importFile.name || 'arquivo')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 80);
      const path = `${userId}/imports/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

      const { error: upErr } = await supabase.storage.from('quiz-imports').upload(path, importFile, {
        upsert: false,
        cacheControl: '3600',
        contentType: importFile.type || undefined,
      } as any);
      if (upErr) throw upErr;

      const createResp = await apiFetch('/api/admin?handler=curation-create-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_bucket: 'quiz-imports', source_path: path, source_mime: importFile.type }),
      });
      const createJson = await createResp.json().catch(() => ({}));
      if (!createResp.ok) throw new Error(createJson?.error || 'Falha ao registrar import');

      const importId = createJson?.import?.id;
      if (!importId) throw new Error('Import id ausente');

      const extractResp = await apiFetch('/api/admin?handler=curation-extract-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId }),
      });
      const extractJson = await extractResp.json().catch(() => ({}));
      if (!extractResp.ok) throw new Error(extractJson?.error || 'Falha ao extrair');

      setImportRow(extractJson?.import || null);
      toast.success('Arquivo processado');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no import');
    } finally {
      setImportLoading(false);
    }
  };

  const runAiStructure = async () => {
    if (!importRow?.id) return;
    setImportLoading(true);
    try {
      const resp = await apiFetch('/api/admin?handler=curation-structure-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: importRow.id }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha na IA');
      setImportRow(json?.import || null);
      toast.success(`IA pronta (${json?.usedModel || 'modelo'})`);
    } catch (e: any) {
      toast.error(e?.message || 'Falha na IA');
    } finally {
      setImportLoading(false);
    }
  };

  const finalizeImport = async () => {
    if (!importRow?.id) return;
    const payload = importRow?.ai_suggested || importRow?.raw_extract || null;
    const questions = Array.isArray(payload?.questions) ? payload.questions : null;
    if (!questions?.length) {
      toast.error('Sem questões estruturadas para aprovar');
      return;
    }
    setImportLoading(true);
    try {
      const resp = await apiFetch('/api/admin?handler=curation-finalize-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: importRow.id, final: { questions } }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao aprovar');
      setImportRow(json?.import || null);
      toast.success('Import aprovado');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao aprovar');
    } finally {
      setImportLoading(false);
    }
  };

  const applyImport = async () => {
    if (!importRow?.id || !applyToQuizId) return;
    setImportLoading(true);
    try {
      const resp = await apiFetch('/api/admin?handler=curation-apply-import-to-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: importRow.id, challengeId: applyToQuizId, source: 'final' }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao aplicar');
      toast.success(`Perguntas criadas: ${json?.created_questions || 0}`);
      if (selectedId === applyToQuizId) {
        await fetchDetail(applyToQuizId);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao aplicar');
    } finally {
      setImportLoading(false);
    }
  };

  const importPreview = useMemo(() => {
    const raw = importRow?.raw_extract;
    const ai = importRow?.ai_suggested;
    const final = importRow?.final_approved;
    const kind = raw?.kind;
    const q =
      (Array.isArray(final?.questions) && final.questions) ||
      (Array.isArray(ai?.questions) && ai.questions) ||
      (Array.isArray(raw?.questions) && raw.questions) ||
      [];
    return { kind, raw, questions: q };
  }, [importRow]);

  return (
    <div className="relative min-h-screen bg-transparent pb-40 md:pb-20 overflow-hidden">
      <ThemedBackground theme="seguranca" />
      <div className="container relative mx-auto p-4 md:p-8 max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-semibold text-blue-50">Studio • Curadoria de Conteúdo</h1>
              <TipDialogButton tipId="studio-curation" ariaLabel="Entenda a Curadoria de Conteúdo" className="inline-flex items-center justify-center rounded-full border border-white/20 bg-black/20 p-1 text-blue-100/80 hover:bg-black/30 hover:text-blue-50" />
            </div>
            <p className="text-sm text-blue-100/80">
              {canCurate ? 'Revisão e publicação de quizzes' : 'Submeta e acompanhe seus quizzes'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => nav('/studio')}>Voltar ao Studio</Button>
            {!canCurate && (
              <Button onClick={onCreateQuiz}>Novo quiz</Button>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {!canCurate && <TabsTrigger value="my">Meus quizzes</TabsTrigger>}
            {canCurate && <TabsTrigger value="inbox">Fila (SUBMITTED)</TabsTrigger>}
            {canCurate && <TabsTrigger value="all">Todos</TabsTrigger>}
            {canCurate && <TabsTrigger value="import">Importar questões</TabsTrigger>}
          </TabsList>

          <TabsContent value="my">
            <Card>
              <CardHeader>
                <CardTitle>Meus quizzes</CardTitle>
                <CardDescription>Rascunhos, submissões e histórico</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
                {!loading && quizzes.length === 0 && <p className="text-sm text-muted-foreground">Nenhum quiz ainda.</p>}
                {quizzes.map((q) => (
                  <button
                    key={q.id}
                    className={`w-full text-left rounded-md border p-3 bg-black/20 hover:bg-black/30 transition ${selectedId === q.id ? 'border-primary' : 'border-white/10'}`}
                    onClick={() => setSelectedId(q.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-blue-50 truncate">{q.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{q.description || '—'}</div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {q.quiz_workflow_status || 'PUBLISHED'}
                      </Badge>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inbox">
            <Card>
              <CardHeader>
                <CardTitle>Fila de curadoria</CardTitle>
                <CardDescription>Quizzes submetidos por líderes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
                {!loading && quizzes.length === 0 && <p className="text-sm text-muted-foreground">Sem itens na fila.</p>}
                {quizzes.map((q) => (
                  <button
                    key={q.id}
                    className={`w-full text-left rounded-md border p-3 bg-black/20 hover:bg-black/30 transition ${selectedId === q.id ? 'border-primary' : 'border-white/10'}`}
                    onClick={() => setSelectedId(q.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-blue-50 truncate">{q.title}</div>
                        <div className="text-[11px] text-muted-foreground">Submetido: {fmt(q.submitted_at)}</div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{q.quiz_workflow_status || 'SUBMITTED'}</Badge>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="all">
            <Card>
              <CardHeader>
                <CardTitle>Todos os quizzes</CardTitle>
                <CardDescription>Visão completa (curador/admin)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
                {!loading && quizzes.length === 0 && <p className="text-sm text-muted-foreground">Nenhum quiz.</p>}
                {quizzes.map((q) => (
                  <button
                    key={q.id}
                    className={`w-full text-left rounded-md border p-3 bg-black/20 hover:bg-black/30 transition ${selectedId === q.id ? 'border-primary' : 'border-white/10'}`}
                    onClick={() => setSelectedId(q.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-blue-50 truncate">{q.title}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{q.description || '—'}</div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{q.quiz_workflow_status || 'PUBLISHED'}</Badge>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="import">
            <Card>
              <CardHeader>
                <CardTitle>Importar questões</CardTitle>
                <CardDescription>CSV/XLSX/PDF → extração server-side → (opcional) estruturar com IA</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Arquivo</Label>
                  <Input type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                  <div className="flex items-center gap-2">
                    <Button disabled={!importFile || importLoading} onClick={runImport}>
                      {importLoading ? 'Processando…' : 'Enviar e extrair'}
                    </Button>
                    <Button variant="outline" disabled={!importRow?.id || importLoading} onClick={runAiStructure}>
                      Estruturar com IA (GPT-5.2)
                    </Button>
                    <Button variant="secondary" disabled={!importRow?.id || importLoading} onClick={finalizeImport}>
                      Aprovar import
                    </Button>
                  </div>
                </div>

                {importRow && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{importRow.status}</Badge>
                      <span className="text-xs text-muted-foreground">{importRow.source_path}</span>
                    </div>
                    {importPreview.kind === 'pdf' && (
                      <Textarea readOnly rows={8} value={String(importPreview.raw?.text || '').slice(0, 4000)} />
                    )}
                    {importPreview.questions?.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-blue-50">
                          Questões detectadas: {importPreview.questions.length}
                        </div>
                        <div className="space-y-2 max-h-[260px] overflow-auto rounded border border-white/10 p-3 bg-black/20">
                          {importPreview.questions.slice(0, 20).map((q: any, idx: number) => (
                            <div key={idx} className="text-xs text-muted-foreground">
                              <span className="text-blue-50 font-medium">{idx + 1}.</span> {String(q?.pergunta || '').slice(0, 180)}
                            </div>
                          ))}
                          {importPreview.questions.length > 20 && (
                            <div className="text-xs text-muted-foreground">… e mais {importPreview.questions.length - 20}</div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Adicionar ao quiz (DRAFT)</Label>
                      <div className="flex items-center gap-2">
                        <Select value={applyToQuizId} onValueChange={setApplyToQuizId}>
                          <SelectTrigger className="max-w-[420px]">
                            <SelectValue placeholder="Selecione um quiz DRAFT" />
                          </SelectTrigger>
                          <SelectContent>
                            {draftQuizzes.map((q) => (
                              <SelectItem key={q.id} value={q.id}>
                                {q.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button disabled={!applyToQuizId || importLoading || String(importRow?.status || '') !== 'FINAL_APPROVED'} onClick={applyImport}>
                          Aplicar
                        </Button>
                      </div>
                      {String(importRow?.status || '') !== 'FINAL_APPROVED' && (
                        <p className="text-xs text-muted-foreground">Para aplicar: finalize o import (status FINAL_APPROVED).</p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle>Detalhes</CardTitle>
            <CardDescription>{selected ? `Selecionado: ${selected.title}` : 'Selecione um quiz na lista'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!selectedId && <p className="text-sm text-muted-foreground">Nada selecionado.</p>}
            {selectedId && detailLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {selectedId && detail?.quiz && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary">{workflow}</Badge>
                  <span className="text-xs text-muted-foreground">Criado: {fmt(detail.quiz.created_at)}</span>
                  <span className="text-xs text-muted-foreground">Submetido: {fmt(detail.quiz.submitted_at)}</span>
                  <span className="text-xs text-muted-foreground">Aprovado: {fmt(detail.quiz.approved_at)}</span>
                  <span className="text-xs text-muted-foreground">Publicado: {fmt(detail.quiz.published_at)}</span>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Título</Label>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} disabled={!canEditDraft && !canCurate} />
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} disabled={!canEditDraft && !canCurate} />
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button onClick={onSaveMeta} disabled={!selectedId || (!canEditDraft && !canCurate)}>Salvar</Button>
                  {!canCurate && workflow === 'DRAFT' && (
                    <Button variant="secondary" onClick={onSubmitForCuration}>Submeter para curadoria</Button>
                  )}
                  {canCurate && workflow === 'SUBMITTED' && (
                    <>
                      <Button variant="secondary" onClick={() => onReview('APPROVED')}>Aprovar</Button>
                      <Button variant="destructive" onClick={() => onReview('REJECTED')}>Reprovar</Button>
                    </>
                  )}
                  {canCurate && workflow === 'APPROVED' && (
                    <Button onClick={onPublish}>Publicar</Button>
                  )}
                </div>

                {canCurate && workflow === 'SUBMITTED' && (
                  <div className="space-y-2">
                    <Label>Observações da curadoria</Label>
                    <Textarea rows={3} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Use para justificar reprovação ou orientar ajustes" />
                  </div>
                )}

                <div className="grid lg:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-blue-50 font-semibold">Perguntas</h3>
                    <QuizQuestionsList challengeId={selectedId} onUpdate={() => fetchDetail(selectedId)} />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-blue-50 font-semibold">Adicionar pergunta</h3>
                    <QuizQuestionForm challengeId={selectedId} onQuestionAdded={() => fetchDetail(selectedId)} />
                  </div>
                </div>

                {canSeeAnswerKey && (
                  <div className="space-y-3">
                    <h3 className="text-blue-50 font-semibold">Gabarito (restrito)</h3>
                    {answerKey.length === 0 && <p className="text-sm text-muted-foreground">Sem gabarito ainda.</p>}
                    <div className="space-y-2">
                      {answerKey.slice(0, 30).map((k) => (
                        <div key={k.id} className="rounded border border-white/10 p-3 bg-black/20">
                          <div className="text-sm text-blue-50 font-medium">{k.question_text}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Correta: <span className="text-blue-50">{k.correct_text || '—'}</span>
                          </div>
                          {k.correct_explanation && (
                            <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                              {k.correct_explanation}
                            </div>
                          )}
                        </div>
                      ))}
                      {answerKey.length > 30 && (
                        <div className="text-xs text-muted-foreground">… e mais {answerKey.length - 30}</div>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <h3 className="text-blue-50 font-semibold">Histórico / comentários</h3>
                  {versions.length > 0 && (
                    <div className="rounded border border-white/10 p-3 bg-black/20">
                      <div className="text-sm text-blue-50 font-medium">Versões (snapshot)</div>
                      <div className="mt-2 space-y-1">
                        {versions.slice(0, 12).map((v) => (
                          <div key={v.id} className="text-xs text-muted-foreground">
                            v{v.version_number} • {fmt(v.created_at)} {v.reason ? `• ${v.reason}` : ''}
                          </div>
                        ))}
                        {versions.length > 12 && (
                          <div className="text-xs text-muted-foreground">… e mais {versions.length - 12}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {comments.length === 0 && <p className="text-sm text-muted-foreground">Sem comentários.</p>}
                  {comments.map((c) => (
                    <div key={c.id} className="rounded border border-white/10 p-3 bg-black/20">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-[10px]">{c.kind}</Badge>
                        <span className="text-[11px] text-muted-foreground">{fmt(c.created_at)}</span>
                      </div>
                      <div className="text-sm text-blue-50 mt-1 whitespace-pre-wrap">{c.message}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <Navigation />
    </div>
  );
}
