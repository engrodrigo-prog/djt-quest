import { useEffect, useState, useCallback } from "react";
import { Pencil, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { difficultyLevels, type DifficultyLevel } from "@/lib/validations/quiz";
import { apiFetch } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { localeToOpenAiLanguageTag } from "@/lib/i18n/language";

interface Question {
  id: string;
  question_text: string;
  difficulty_level: DifficultyLevel;
  xp_value: number;
  order_index: number;
}

type OptionRow = {
  id: string;
  option_text: string;
  is_correct: boolean;
  explanation: string | null;
};

interface QuizQuestionsListProps {
  challengeId: string;
  onUpdate: () => void;
}

export function QuizQuestionsList({ challengeId, onUpdate }: QuizQuestionsListProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [challengeTitle, setChallengeTitle] = useState<string>("");
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editGenerating, setEditGenerating] = useState(false);
  const [editQuestionId, setEditQuestionId] = useState<string | null>(null);
  const [editQuestionText, setEditQuestionText] = useState("");
  const [editDifficulty, setEditDifficulty] = useState<DifficultyLevel>("basico");
  const [editOptions, setEditOptions] = useState<OptionRow[]>([]);

  const MILHAO_PRIZE_XP = [100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000] as const;

  const loadQuestions = useCallback(async () => {
    try {
      try {
        const { data: ch } = await supabase.from("challenges").select("title").eq("id", challengeId).maybeSingle();
        if (ch?.title) setChallengeTitle(String(ch.title));
      } catch {
        // ignore
      }
      const { data, error } = await supabase
        .from("quiz_questions")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("order_index");

      if (error) throw error;
      setQuestions((data || []) as Question[]);
    } catch (error) {
      console.error("Error loading questions:", error);
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const handleDelete = useCallback(async (questionId: string) => {
    if (!confirm("Deseja realmente excluir esta pergunta?")) return;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Não autenticado");

      const resp = await apiFetch("/api/admin?handler=curation-delete-quiz-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ questionId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao excluir pergunta");

      toast.success("Pergunta excluída");
      loadQuestions();
      onUpdate();
    } catch (error) {
      console.error("Error deleting question:", error);
      toast.error((error as any)?.message || "Erro ao excluir pergunta");
    }
  }, [loadQuestions, onUpdate]);

  const openEditor = useCallback(async (questionId: string) => {
    const qid = String(questionId || "").trim();
    if (!qid) return;
    setEditOpen(true);
    setEditLoading(true);
    setEditQuestionId(qid);
    try {
      const resp = await apiFetch(`/api/admin?handler=studio-get-quiz-question&questionId=${encodeURIComponent(qid)}`, {
        method: "GET",
        cache: "no-store",
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar pergunta");
      const q = json?.question || {};
      const opts = Array.isArray(json?.options) ? (json.options as any[]) : [];
      const normalized: OptionRow[] = opts
        .map((o: any) => ({
          id: String(o?.id || ""),
          option_text: String(o?.option_text || "").trim(),
          is_correct: Boolean(o?.is_correct),
          explanation: o?.explanation == null ? null : String(o.explanation),
        }))
        .filter((o) => o.id && o.option_text.length > 0);
      // Pad to 4 options for editing UX.
      while (normalized.length < 4) {
        normalized.push({ id: "", option_text: "", is_correct: false, explanation: null });
      }
      // Ensure exactly one correct.
      const correctCount = normalized.filter((o) => o.is_correct).length;
      if (correctCount !== 1) {
        normalized.forEach((o, idx) => (o.is_correct = idx === 0));
      }
      setEditQuestionText(String(q?.question_text || "").trim());
      setEditDifficulty((String(q?.difficulty_level || "basico") as any) || "basico");
      setEditOptions(normalized.slice(0, 4));
    } catch (e: any) {
      toast.error(e?.message || "Falha ao abrir editor");
      setEditOpen(false);
      setEditQuestionId(null);
    } finally {
      setEditLoading(false);
    }
  }, []);

  const setCorrectIndex = useCallback((idx: number) => {
    setEditOptions((prev) => prev.map((o, i) => ({ ...o, is_correct: i === idx })));
  }, []);

  const saveEditor = useCallback(async () => {
    if (!editQuestionId) return;
    const text = String(editQuestionText || "").trim();
    if (text.length < 10) {
      toast.error("Pergunta muito curta");
      return;
    }
    const opts = editOptions.map((o) => ({
      id: o.id,
      option_text: String(o.option_text || "").trim(),
      is_correct: Boolean(o.is_correct),
      explanation: String(o.explanation || "").trim(),
    }));
    if (opts.length !== 4 || opts.some((o) => o.option_text.length < 2) || opts.filter((o) => o.is_correct).length !== 1) {
      toast.error("Precisa de 4 alternativas e 1 correta");
      return;
    }
    setEditSaving(true);
    try {
      const resp = await apiFetch("/api/admin?handler=studio-update-quiz-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: editQuestionId,
          question_text: text,
          difficulty_level: editDifficulty,
          options: opts,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao salvar");
      toast.success("Pergunta atualizada");
      setEditOpen(false);
      setEditQuestionId(null);
      loadQuestions();
      onUpdate();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar");
    } finally {
      setEditSaving(false);
    }
  }, [editDifficulty, editOptions, editQuestionId, editQuestionText, loadQuestions, onUpdate]);

  const regenerateWrongOptions = useCallback(async () => {
    if (!editQuestionId) return;
    const text = String(editQuestionText || "").trim();
    if (text.length < 10) return;
    const correct = editOptions.find((o) => o.is_correct) || editOptions[0];
    if (!correct?.option_text) return;

    const avoid = editOptions.filter((o) => !o.is_correct).map((o) => o.option_text).filter(Boolean);
    const questionOnlyContext = questions.map((q) => String(q.question_text || "").trim()).filter(Boolean).slice(0, 12).join("\n");

    setEditGenerating(true);
    try {
      const resp = await apiFetch("/api/ai?handler=generate-wrongs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          correct: String(correct.option_text || "").trim(),
          difficulty: editDifficulty,
          language: localeToOpenAiLanguageTag(getActiveLocale()),
          count: 3,
          avoid,
          context: questionOnlyContext ? `Outras perguntas do quiz:\n${questionOnlyContext}` : null,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao gerar alternativas");
      const wrong = Array.isArray(json?.wrong) ? json.wrong : [];
      const wrongs = wrong
        .map((w: any) => ({ text: String(w?.text || "").trim(), explanation: String(w?.explanation || "").trim() }))
        .filter((w: any) => w.text.length > 0)
        .slice(0, 3);
      if (wrongs.length !== 3) throw new Error("IA não retornou 3 alternativas");
      const wrongSlots = editOptions
        .map((o, idx) => ({ o, idx }))
        .filter(({ o }) => !o.is_correct)
        .map(({ idx }) => idx);
      setEditOptions((prev) => {
        const next = [...prev];
        for (let i = 0; i < wrongSlots.length; i++) {
          const slot = wrongSlots[i];
          next[slot] = { ...next[slot], option_text: wrongs[i].text, explanation: wrongs[i].explanation || null };
        }
        return next;
      });
      toast.success("Alternativas erradas regeneradas");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao regenerar");
    } finally {
      setEditGenerating(false);
    }
  }, [editDifficulty, editOptions, editQuestionId, editQuestionText, questions]);

  if (loading) return <div className="text-center text-sm text-muted-foreground">Carregando...</div>;

  if (questions.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground p-4 border-2 border-dashed rounded-lg">
        Nenhuma pergunta adicionada ainda
      </div>
    );
  }

  const isMilhao = /milh(ã|a)o/i.test(challengeTitle || "");
  const totalXP = isMilhao
    ? questions.reduce((sum, _q, idx) => sum + (MILHAO_PRIZE_XP[idx] ?? 0), 0)
    : questions.reduce((sum, q) => sum + q.xp_value, 0);

  const dbToUi: Record<string, DifficultyLevel> = {
    basica: 'basico',
    intermediaria: 'intermediario',
    avancada: 'avancado',
    especialista: 'especialista',
  } as const;

  const milhaoTarget = 10;
  const milhaoProgress = Math.min(100, Math.round((questions.length / milhaoTarget) * 100));

  return (
    <div className="space-y-4">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar pergunta</DialogTitle>
            <DialogDescription>Revise o enunciado e as 4 alternativas. Você pode regenerar as erradas com IA.</DialogDescription>
          </DialogHeader>

          {editLoading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Enunciado</Label>
                <Textarea value={editQuestionText} onChange={(e) => setEditQuestionText(e.target.value)} rows={3} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Dificuldade</Label>
                  <Select value={editDifficulty} onValueChange={(v) => setEditDifficulty(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basico">Básico</SelectItem>
                      <SelectItem value="intermediario">Intermediário</SelectItem>
                      <SelectItem value="avancado">Avançado</SelectItem>
                      <SelectItem value="especialista">Especialista</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-end gap-2">
                  <Button type="button" variant="outline" disabled={editGenerating} onClick={regenerateWrongOptions}>
                    <Wand2 className="h-4 w-4 mr-2" />
                    {editGenerating ? "Gerando…" : "Regenerar erradas (IA)"}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Alternativas (marque a correta)</Label>
                {editOptions.map((o, idx) => (
                  <div key={idx} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="correct-edit"
                        className="accent-primary"
                        checked={o.is_correct}
                        onChange={() => setCorrectIndex(idx)}
                      />
                      <Input
                        value={o.option_text}
                        onChange={(e) =>
                          setEditOptions((prev) => prev.map((p, i) => (i === idx ? { ...p, option_text: e.target.value } : p)))
                        }
                        placeholder={`Alternativa ${String.fromCharCode(65 + idx)}`}
                      />
                    </div>
                    <Textarea
                      value={o.explanation || ""}
                      onChange={(e) =>
                        setEditOptions((prev) => prev.map((p, i) => (i === idx ? { ...p, explanation: e.target.value } : p)))
                      }
                      placeholder="Explicação (opcional)"
                      rows={2}
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
                <Button type="button" disabled={editSaving} onClick={saveEditor}>
                  {editSaving ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Perguntas ({questions.length})</h3>
        <Badge variant="default" className="text-sm">
          Total: {totalXP} XP
        </Badge>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Progresso para Quiz do Milhão (10 perguntas)</span>
          <span>{milhaoProgress}%</span>
        </div>
        <Progress value={milhaoProgress} className="h-2" />
      </div>
      {questions.map((question, index) => (
        <Card key={question.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">#{index + 1}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {difficultyLevels[dbToUi[question.difficulty_level] || 'basico'].label} -{" "}
                    {isMilhao ? (MILHAO_PRIZE_XP[index] ?? question.xp_value) : question.xp_value} XP
                  </span>
                </div>
                <p className="text-sm">{question.question_text}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" onClick={() => void openEditor(question.id)} title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(question.id)} title="Excluir">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
