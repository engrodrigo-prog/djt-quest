import { AttachmentUploader } from "@/components/AttachmentUploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import { CATEGORY_LABELS, CATEGORY_ORDER, PRIVATE_TTL_DAYS, normalizeCategory } from "./catalog-utils";
import type { IncidentForm, StudyCategory } from "./catalog-utils";

export interface UploadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  category: StudyCategory;
  onCategoryChange: (v: StudyCategory) => void;

  visibility: "public" | "private";
  onVisibilityChange: (v: "public" | "private") => void;

  incident: IncidentForm;
  onIncidentChange: (updater: (prev: IncidentForm) => IncidentForm) => void;

  url: string;
  onUrlChange: (v: string) => void;
  adding: boolean;
  onAdd: () => void;

  onFilesUploaded: (files: any[]) => void;
}

export function UploadSheet({
  open,
  onOpenChange,
  category,
  onCategoryChange,
  visibility,
  onVisibilityChange,
  incident,
  onIncidentChange,
  url,
  onUrlChange,
  adding,
  onAdd,
  onFilesUploaded,
}: UploadSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Adicionar material</SheetTitle>
          <SheetDescription>Envie um arquivo ou URL. A IA cria título, resumo e índice.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Catalogar como</Label>
              <Select value={category} onValueChange={(v) => onCategoryChange(normalizeCategory(v))}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Visibilidade</Label>
              <Select value={visibility} onValueChange={(v) => onVisibilityChange(v as "public" | "private")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Público (para todos)</SelectItem>
                  <SelectItem value="private">Privado (expira em {PRIVATE_TTL_DAYS} dias)</SelectItem>
                </SelectContent>
              </Select>
              {visibility === "private" && (
                <p className="text-xs text-muted-foreground">
                  Materiais privados expiram automaticamente após {PRIVATE_TTL_DAYS} dias.
                </p>
              )}
            </div>
          </div>

          {category === "RELATORIO_OCORRENCIA" && (
            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Relatório de ocorrência</p>
              <p className="text-xs text-muted-foreground">Preencha o mínimo e envie o material/URL para a IA catalogar.</p>
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label>1) O que aconteceu? *</Label>
                  <Textarea value={incident.ocorrido} rows={3}
                    onChange={(e) => onIncidentChange((p) => ({ ...p, ocorrido: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>2) Causa raiz e/ou modo de falha? *</Label>
                  <Textarea value={incident.causaRaizModoFalha} rows={3}
                    onChange={(e) => onIncidentChange((p) => ({ ...p, causaRaizModoFalha: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>3) Barreiras/cuidado que poderiam evitar?</Label>
                  <Textarea value={incident.barreirasCuidados} rows={3}
                    onChange={(e) => onIncidentChange((p) => ({ ...p, barreirasCuidados: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>4) Ações corretivas e preventivas (CAPA)</Label>
                  <Textarea value={incident.acoesCorretivasPreventivas} rows={3}
                    onChange={(e) => onIncidentChange((p) => ({ ...p, acoesCorretivasPreventivas: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>5) O que mudou para não repetir?</Label>
                  <Textarea value={incident.mudancasImplementadas} rows={3}
                    onChange={(e) => onIncidentChange((p) => ({ ...p, mudancasImplementadas: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="study-url">URL do material</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="study-url" type="url" value={url} onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://artigo-ou-video..." className="flex-1" />
              <Button type="button" onClick={onAdd} disabled={adding || !url.trim()}>
                {adding ? "Adicionando..." : "Adicionar"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Ou envie um arquivo</Label>
            <AttachmentUploader
              onAttachmentsChange={onFilesUploaded}
              maxFiles={category === "RELATORIO_OCORRENCIA" ? 1 : 3}
              maxSizeMB={20}
              bucket="evidence"
              pathPrefix="study"
              acceptMimeTypes={[
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "text/plain",
                "application/json",
                "text/csv",
                "image/jpeg",
                "image/png",
                "image/webp",
              ]}
              maxVideoSeconds={0}
            />
            <p className="text-xs text-muted-foreground">Após enviar, a IA gera título/resumo/índice e você encontra no Catálogo.</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
