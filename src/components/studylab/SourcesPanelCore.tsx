import { useMemo, useState } from "react";
import { BookOpen, Loader2, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Types (mirrored from StudyLab; move to shared types once monolith splits) ──

export interface StudySourceMini {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  scope?: string | null;
  published?: boolean | null;
  category?: string | null;
  topic?: string | null;
  ingest_status?: "pending" | "ok" | "failed" | null;
  metadata?: any | null;
  user_id: string;
  is_persistent: boolean;
}

export const STUDY_CATEGORIES_PANEL = [
  "MANUAIS",
  "PROCEDIMENTOS",
  "APOSTILAS",
  "RELATORIO_OCORRENCIA",
  "AUDITORIA_INTERNA",
  "AUDITORIA_EXTERNA",
  "OUTROS",
] as const;

export type StudyCategoryPanel = (typeof STUDY_CATEGORIES_PANEL)[number];

export const CATEGORY_LABELS_PANEL: Record<StudyCategoryPanel, string> = {
  MANUAIS: "Manuais",
  PROCEDIMENTOS: "Procedimentos",
  APOSTILAS: "Apostilas",
  RELATORIO_OCORRENCIA: "Relatório de Ocorrência",
  AUDITORIA_INTERNA: "Auditoria Interna",
  AUDITORIA_EXTERNA: "Auditoria Externa",
  OUTROS: "Outros",
};

function normalizeCat(raw: unknown): StudyCategoryPanel {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  return (STUDY_CATEGORIES_PANEL as readonly string[]).includes(s)
    ? (s as StudyCategoryPanel)
    : "OUTROS";
}

function normalizeScope(raw: unknown): "org" | "user" {
  return String(raw || "").trim().toLowerCase() === "org" ? "org" : "user";
}

const FIXED_RULES_ID = "fixed:djt-quest-rules";

function isFixed(s: StudySourceMini) {
  return s.id === FIXED_RULES_ID;
}
function isPublic(s: StudySourceMini) {
  return normalizeScope(s.scope) === "org" && s.published !== false;
}

// ── Component ──────────────────────────────────────────────────────────────────

export type SourcesPanelCoreProps = {
  sources: StudySourceMini[];
  loadingSources: boolean;
  activeIds: string[];
  onToggle: (id: string) => void;
  onClearAll: () => void;
  onOpenUpload: () => void;
  onOpenCatalog: () => void;
};

export function SourcesPanelCore({
  sources,
  loadingSources,
  activeIds,
  onToggle,
  onClearAll,
  onOpenUpload,
  onOpenCatalog,
}: SourcesPanelCoreProps) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<StudyCategoryPanel | "ALL">("ALL");
  const [visFilter, setVisFilter] = useState<"all" | "public" | "private">("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sources.filter((s) => {
      if (catFilter !== "ALL" && normalizeCat(s.category) !== catFilter) return false;
      if (visFilter === "public" && !isPublic(s) && !isFixed(s)) return false;
      if (visFilter === "private" && (isPublic(s) || isFixed(s))) return false;
      if (!q) return true;
      return (
        String(s.title || "").toLowerCase().includes(q) ||
        String(s.summary || "").toLowerCase().includes(q)
      );
    });
  }, [sources, search, catFilter, visFilter]);

  const activeCount = activeIds.length;

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Fontes</span>
          {activeCount > 0 && (
            <Badge className="text-[10px] h-4 px-1.5">{activeCount}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Desmarcar todas"
              onClick={onClearAll}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Adicionar fonte"
            onClick={onOpenUpload}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex gap-1.5">
          <Select
            value={catFilter}
            onValueChange={(v) => setCatFilter(v as StudyCategoryPanel | "ALL")}
          >
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas</SelectItem>
              {STUDY_CATEGORIES_PANEL.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABELS_PANEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={visFilter}
            onValueChange={(v) => setVisFilter(v as "all" | "public" | "private")}
          >
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue placeholder="Visib." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="public">Públicos</SelectItem>
              <SelectItem value="private">Privados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Source list */}
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0 pr-0.5">
        {loadingSources ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando…
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">Nenhuma fonte encontrada.</p>
        ) : (
          filtered.map((s) => {
            const active = activeIds.includes(s.id);
            const canSelect =
              s.ingest_status !== "pending" &&
              !(s.ingest_status === "failed" && !isFixed(s));
            const vis = isFixed(s) ? "FIXO" : isPublic(s) ? "PUB" : "PRIV";
            const statusBadge =
              s.ingest_status === "pending" ? (
                <Badge variant="outline" className="text-[9px] h-3.5 px-1">analisando</Badge>
              ) : s.ingest_status === "failed" && !isFixed(s) ? (
                <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-red-400 text-red-500">falhou</Badge>
              ) : null;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => canSelect && onToggle(s.id)}
                disabled={!canSelect}
                className={[
                  "w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors text-sm",
                  active
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/50 border border-transparent",
                  !canSelect ? "opacity-50 cursor-default" : "cursor-pointer",
                ].join(" ")}
              >
                {/* Checkbox visual */}
                <span
                  className={[
                    "mt-0.5 h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center",
                    active
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/40",
                  ].join(" ")}
                >
                  {active && (
                    <svg viewBox="0 0 8 8" className="h-2 w-2 fill-primary-foreground">
                      <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium leading-snug">{s.title || "Sem título"}</span>
                  <span className="flex items-center gap-1 mt-0.5 flex-wrap">
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1">{vis}</Badge>
                    {statusBadge}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Footer: browse catalog */}
      <div className="shrink-0 pt-1 border-t">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-xs h-7 text-muted-foreground"
          onClick={onOpenCatalog}
        >
          Navegar catálogo completo
        </Button>
      </div>
    </div>
  );
}
