import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Wand2 } from "lucide-react";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { useToast } from "@/hooks/use-toast";
import { campaignSchema, type CampaignFormData } from "@/lib/validations/challenge";
import { useState, useEffect } from "react";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";

export const CampaignForm = () => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
  });

  const onSubmit = async (data: CampaignFormData) => {
    setSubmitting(true);

    try {
      const { error } = await supabase.from("campaigns").insert({
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

  const handleCleanupDescription = async () => {
    try {
      const desc = (document.getElementById("description") as HTMLTextAreaElement | null)?.value || "";
      if (!desc.trim()) return;
      const resp = await fetch("/api/ai?handler=cleanup-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", description: desc, language: "pt-BR" }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.cleaned?.description) {
        throw new Error(json?.error || "Falha na revisão automática");
      }
      setValue("description", json.cleaned.description, { shouldValidate: true });
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
