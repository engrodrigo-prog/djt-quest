import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Wand2 } from "lucide-react";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { useToast } from "@/hooks/use-toast";
import { campaignSchema, type CampaignFormData } from "@/lib/validations/challenge";
import { useState, useEffect } from "react";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { localeToOpenAiLanguageTag, localeToSpeechLanguage } from "@/lib/i18n/language";
import { ForumKbThemeSelector, type ForumKbSelection } from "@/components/ForumKbThemeSelector";
import { fetchForumKbSnippets, type ForumKbSnippet } from "@/lib/forum/fetchKbSnippets";
import { apiFetch } from "@/lib/api";

export const CampaignForm = () => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [kbSelection, setKbSelection] = useState<ForumKbSelection | null>(null);
  const [kbSnippets, setKbSnippets] = useState<ForumKbSnippet[]>([]);
  const [kbLoading, setKbLoading] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
  });

  const descriptionValue = watch("description") as any;
  const narrativeTagValue = watch("narrative_tag") as any;

  const onSubmit = async (data: CampaignFormData) => {
    setSubmitting(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Não autenticado");
      const { error } = await supabase.from("campaigns").insert({
        created_by: uid,
        title: data.title,
        description: data.description || null,
        narrative_tag: data.narrative_tag || null,
        start_date: data.start_date,
        end_date: data.end_date,
        is_active: true,
        cover_image_url: coverUrl || null,
      } as any);

      if (error) throw error;

      toast({
        title: "Campanha criada! 🎯",
        description: "A campanha foi publicada com sucesso",
      });

      reset();
      setCoverUrl(null);
    } catch (error: any) {
      console.error("Error creating campaign:", error);
      toast({
        title: "Erro ao criar campanha",
        description: error.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Prefill from Forum Insights draft (campanha)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('studio_compendium_draft');
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || draft.kind !== 'campanha') return;
      const title = String(draft.title || '').replace(/^Campanha:\s*/i,'').trim();
      const description = String(draft.summary || '');
      if (title) setValue('title', title);
      if (description) setValue('description', description);
      localStorage.removeItem('studio_compendium_draft');
    } catch {}
  }, [setValue]);

  useEffect(() => {
    let cancelled = false;
    const key = kbSelection?.tags?.join("|") || "";
    if (!key) {
      setKbSnippets([]);
      return;
    }
    setKbLoading(true);
    fetchForumKbSnippets({ tags: kbSelection!.tags, limit: 6 })
      .then((rows) => {
        if (!cancelled) setKbSnippets(rows);
      })
      .catch(() => {
        if (!cancelled) setKbSnippets([]);
      })
      .finally(() => {
        if (!cancelled) setKbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbSelection?.tags?.join("|")]);

  const handleCleanupDescription = async () => {
    try {
      const desc = (document.getElementById("description") as HTMLTextAreaElement | null)?.value || "";
      if (!desc.trim()) return;
      const resp = await apiFetch("/api/ai?handler=cleanup-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", description: desc, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
      });
      const json = await resp.json().catch(() => ({}));
      const usedAI = json?.meta?.usedAI !== false;
      if (!resp.ok || !json?.cleaned?.description) {
        throw new Error(json?.error || "Falha na revisão automática");
      }
      if (!usedAI) {
        toast({ title: "Erro ao revisar descrição", description: "IA indisponível no momento. Tente novamente.", variant: "destructive" });
        return;
      }
      const cleaned = String(json.cleaned.description || desc).trim();
      if (cleaned === desc.trim()) {
        toast({ title: "Nenhuma correção necessária", description: "Não encontrei ajustes de ortografia/pontuação para fazer." });
        return;
      }
      setValue("description", cleaned, { shouldValidate: true });
      toast({ title: "Descrição revisada", description: "Ortografia e pontuação ajustadas." });
    } catch (e: any) {
      toast({ title: "Erro ao revisar descrição", description: e?.message || "Tente novamente", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar Nova Campanha</CardTitle>
        <CardDescription>
          Campanhas são períodos temáticos com objetivos específicos
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label>Capa (opcional)</Label>
            <AttachmentUploader 
              onAttachmentsChange={(urls) => setCoverUrl(urls[0] || null)}
              maxFiles={1}
              acceptMimeTypes={[ 'image/jpeg','image/png','image/webp','image/gif' ]}
              bucket="evidence"
              pathPrefix="campaigns"
              capture="environment"
            />
            {coverUrl && (
              <div className="mt-2">
                <img src={coverUrl} alt="Capa" className="h-28 w-full object-cover rounded-md" />
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="title">Título *</Label>
            <Input
              id="title"
              {...register("title")}
              placeholder="Ex: Operação Zero Desligamentos"
            />
            {errors.title && (
              <p className="text-sm text-destructive mt-1">{errors.title.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="description">Descrição</Label>
              <div className="flex items-center gap-2">
                <VoiceRecorderButton
                  language={localeToSpeechLanguage(getActiveLocale())}
                  onText={(text) => {
                    const current = (document.getElementById("description") as HTMLTextAreaElement | null)?.value || "";
                    const combined = [current, text].filter(Boolean).join("\n\n");
                    setValue("description", combined, { shouldValidate: true });
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={handleCleanupDescription}
                  title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Textarea
              id="description"
              {...register("description")}
              placeholder="Descreva os objetivos e contexto da campanha..."
              rows={3}
            />
            {errors.description && (
              <p className="text-sm text-destructive mt-1">{errors.description.message}</p>
            )}
          </div>

          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Base de conhecimento (Fórum + StudyLab)</p>
                <p className="text-[11px] text-muted-foreground">
                  Selecione um tema/subtema (até 3 níveis) para puxar trechos e enriquecer a narrativa/descrição da campanha.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!kbSelection?.path?.length}
                  onClick={() => {
                    if (!kbSelection?.path?.length) return;
                    const next = kbSelection.path.join("_").slice(0, 40);
                    const current = String(narrativeTagValue || "").trim();
                    setValue("narrative_tag", current || next, { shouldValidate: true });
                    toast({ title: "Tag narrativa sugerida a partir da base de conhecimento" });
                  }}
                >
                  Aplicar tag narrativa
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!kbSelection?.tags?.length}
                  onClick={() => {
                    if (!kbSelection?.tags?.length) return;
                    const current = String(descriptionValue || "").trim();
                    const hashLine = kbSelection.tags
                      .slice(0, 10)
                      .map((t) => `#${t}`)
                      .join(" ");
                    const next = [current, hashLine].filter(Boolean).join("\n\n");
                    setValue("description", next, { shouldValidate: true });
                    toast({ title: "Hashtags adicionadas à descrição" });
                  }}
                >
                  Inserir # na descrição
                </Button>
              </div>
            </div>

            <ForumKbThemeSelector maxTags={20} onChange={setKbSelection} />

            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                {kbSelection?.label ? `Foco: ${kbSelection.label}` : "Escolha um foco para ver trechos."}
              </p>

              {kbLoading ? (
                <p className="text-xs text-muted-foreground">Carregando trechos…</p>
              ) : kbSelection?.tags?.length && kbSnippets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum trecho encontrado na base de conhecimento para essas hashtags (usa fórum curado e StudyLab).
                </p>
              ) : (
                kbSnippets.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold">Trechos sugeridos</p>
                    <div className="space-y-2">
                    {kbSnippets.map((s) => {
                        const flags = [
                          s.sourceType === "study" ? "StudyLab" : "",
                          s.isSolution ? "solução" : "",
                          s.isFeatured ? "destaque" : "",
                          s.likesCount ? `${s.likesCount} curtidas` : "",
                        ]
                          .filter(Boolean)
                          .join(" • ");
                        const excerpt = String(s.content || "").replace(/\s+/g, " ").trim().slice(0, 220);
                        return (
                          <div key={s.postId} className="rounded-md border border-border bg-background/60 p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium truncate">{s.topicTitle}</p>
                              {flags && (
                                <Badge variant="outline" className="text-[10px]">
                                  {flags}
                                </Badge>
                              )}
                            </div>
                            {excerpt && <p className="text-xs text-muted-foreground">{excerpt}{excerpt.length >= 220 ? "…" : ""}</p>}
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!kbSnippets.length || !kbSelection?.label}
                      onClick={() => {
                        if (!kbSelection?.label || !kbSnippets.length) return;
                        const header = [
                          "---",
                          `Contexto da Base de Conhecimento: ${kbSelection.label}`,
                          kbSelection.tags.length ? `Hashtags: ${kbSelection.tags.slice(0, 10).map((t) => `#${t}`).join(" ")}` : "",
                          "",
                        ]
                          .filter(Boolean)
                          .join("\n");
                        const lines = kbSnippets.map((s) => {
                          const ex = String(s.content || "").replace(/\s+/g, " ").trim().slice(0, 320);
                          return `- ${s.topicTitle}: ${ex}${ex.length >= 320 ? "…" : ""}`;
                        });
                        const current = String(descriptionValue || "").trim();
                        const next = [current, header, ...lines].filter(Boolean).join("\n\n");
                        setValue("description", next, { shouldValidate: true });
                        toast({ title: "Contexto da base de conhecimento inserido na descrição" });
                      }}
                    >
                      Inserir trechos na descrição
                    </Button>
                  </div>
                )
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="tag">Tag Narrativa</Label>
            <Input
              id="tag"
              {...register("narrative_tag")}
              placeholder="Ex: NR10, DirecaoSegura, ZeroDesligamentos"
            />
            {errors.narrative_tag && (
              <p className="text-sm text-destructive mt-1">{errors.narrative_tag.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start">Data Início *</Label>
              <Input id="start" type="datetime-local" {...register("start_date")} />
              {errors.start_date && (
                <p className="text-sm text-destructive mt-1">{errors.start_date.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="end">Data Fim *</Label>
              <Input id="end" type="datetime-local" {...register("end_date")} />
              {errors.end_date && (
                <p className="text-sm text-destructive mt-1">{errors.end_date.message}</p>
              )}
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              "Criando..."
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Criar Campanha
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
