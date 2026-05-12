import { Card, CardContent } from "@/components/ui/card";

export interface ProgressCardsProps {
  ingesting: boolean;
  catalogRefreshing: boolean;
  catalogRefreshProgress: { total: number; done: number; failed: number } | null;
}

export function ProgressCards({ ingesting, catalogRefreshing, catalogRefreshProgress }: ProgressCardsProps) {
  return (
    <>
      {ingesting && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Analisando materiais...</p>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 bg-primary animate-pulse" />
            </div>
          </CardContent>
        </Card>
      )}

      {catalogRefreshing && catalogRefreshProgress && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Atualizando catálogo com IA...</p>
              <span className="text-xs text-muted-foreground">
                {catalogRefreshProgress.done}/{catalogRefreshProgress.total}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${Math.round(
                    (catalogRefreshProgress.done / Math.max(1, catalogRefreshProgress.total)) * 100,
                  )}%`,
                }}
              />
            </div>
            {catalogRefreshProgress.failed > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {catalogRefreshProgress.failed} materiais falharam e serão mantidos com os dados atuais.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
