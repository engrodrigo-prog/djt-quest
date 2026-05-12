import { History, LibraryBig, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TipDialogButton } from "@/components/TipDialogButton";

export interface StudyLabHeaderProps {
  onOpenHistory: () => void;
  onOpenCatalog: () => void;
  onOpenUpload: () => void;
}

export function StudyLabHeader({ onOpenHistory, onOpenCatalog, onOpenUpload }: StudyLabHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">StudyLab</h1>
          <TipDialogButton tipId="studylab-oracle" ariaLabel="Entenda o StudyLab" />
        </div>
        <p className="text-sm text-muted-foreground">
          Selecione fontes no painel e pergunte. Sem fontes marcadas, a IA usa o catálogo geral.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="lg:hidden" onClick={onOpenHistory}>
          <History className="mr-2 h-4 w-4" />
          Histórico
        </Button>
        <Button type="button" variant="outline" onClick={onOpenCatalog}>
          <LibraryBig className="mr-2 h-4 w-4" />
          Catálogo
        </Button>
        <Button type="button" onClick={onOpenUpload}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar
        </Button>
      </div>
    </div>
  );
}
