import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { campaignSchema, type CampaignFormData } from "@/lib/validations/challenge";
import { useState, useEffect } from "react";

export const CampaignForm = () => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

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
      });

      if (error) throw error;

      toast({
        title: "Campanha criada! 🎯",
        description: "A campanha foi publicada com sucesso",
      });

      reset();
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
      // We cannot set form values directly without useForm setValue; filled by placeholders via direct DOM fallback
      // Keep as hint: user will copy/adjust. For minimal warnings, just notify.
      if (title) setValue('title', title);
      if (description) setValue('description', description);
      localStorage.removeItem('studio_compendium_draft');
    } catch {}
  }, []);

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

          <div>
            <Label htmlFor="description">Descrição</Label>
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
