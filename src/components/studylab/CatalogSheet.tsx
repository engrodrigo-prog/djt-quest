import type React from "react";
import { ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  FIXED_RULES_ID,
  TOPIC_LABELS,
  displaySummary,
  getSourceCategoryKey,
  getSourceMeta,
  getSourceTags,
  getSourceTopicKey,
  isFixedSource,
  isPublicSource,
  renderOutline,
  statusBadge,
} from "./catalog-utils";
import type { StudySource } from "./catalog-utils";

export interface CatalogSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  tab: "tree" | "list";
  onTabChange: (tab: "tree" | "list") => void;

  search: string;
  onSearchChange: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  hasActiveFilters: boolean;
  onClearFilters: () => void;

  visibilityFilter: "all" | "public" | "private";
  onVisibilityFilterChange: (v: "all" | "public" | "private") => void;
  categoryFilter: string;
  onCategoryFilterChange: (v: string) => void;
  topicFilter: string;
  onTopicFilterChange: (v: string) => void;

  isStaff: boolean;
  refreshing: boolean;
  refreshProgress: { done: number; total: number; failed: number } | null;
  ingesting: boolean;
  loadingSources: boolean;
  onRecatalog: () => void;
  onReingestFailed: () => void;
  cacheCleaning: boolean;
  onCleanCache: () => void;

  sources: StudySource[];
  topicsByCategory: Record<string, Record<string, number>>;
  selectedSourceId: string | null;
  oracleMode: boolean;

  previewId: string | null;
  onPreviewIdChange: (id: string | null) => void;
  previewSource: StudySource | null;
  previewPrevId: string | null;
  previewNextId: string | null;
  previewIndex: number;
  sourcesCount: number;

  reingestingSourceId: string | null;
  studioAccess: boolean;
  userId: string | null;

  onSelectSource: (s: StudySource) => void;
  onDeleteSource: (id: string) => void;
  onReingestSource: (id: string) => void;
  onNavigateToQuiz: (sourceId: string) => void;
}

export function CatalogSheet({
  open,
  onOpenChange,
  tab,
  onTabChange,
  search,
  onSearchChange,
  searchRef,
  hasActiveFilters,
  onClearFilters,
  visibilityFilter,
  onVisibilityFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  topicFilter,
  onTopicFilterChange,
  isStaff,
  refreshing,
  refreshProgress,
  ingesting,
  loadingSources,
  onRecatalog,
  onReingestFailed,
  cacheCleaning,
  onCleanCache,
  sources,
  topicsByCategory,
  selectedSourceId,
  oracleMode,
  previewId,
  onPreviewIdChange,
  previewSource,
  previewPrevId,
  previewNextId,
  previewIndex,
  sourcesCount,
  reingestingSourceId,
  studioAccess,
  userId,
  onSelectSource,
  onDeleteSource,
  onReingestSource,
  onNavigateToQuiz,
}: CatalogSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col overflow-hidden p-0">
        <SheetHeader className="shrink-0 px-6 pt-6 pb-3">
          <SheetTitle>Catálogo</SheetTitle>
          <SheetDescription>Busque, filtre e selecione um material para usar no chat.</SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => onTabChange(v as "tree" | "list")} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="shrink-0 space-y-2 px-6 pb-2">
            <div className="flex gap-2">
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Buscar por título, resumo, tags, tema…"
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={onClearFilters} disabled={!hasActiveFilters}>
                Limpar
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Visibilidade</Label>
                <Select value={visibilityFilter} onValueChange={(v) => onVisibilityFilterChange(v as "all" | "public" | "private")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="public">Públicos</SelectItem>
                    <SelectItem value="private">Privados</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas</SelectItem>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tema</Label>
                <Select value={topicFilter} onValueChange={onTopicFilterChange}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos</SelectItem>
                    {Object.keys(TOPIC_LABELS).map((k) => (
                      <SelectItem key={k} value={k}>{TOPIC_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isStaff && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
                <span className="text-[11px] text-muted-foreground font-medium">Admin:</span>
                <Button type="button" size="sm" variant="outline" onClick={onRecatalog}
                  disabled={refreshing || ingesting || loadingSources} className="h-7 text-xs">
                  {refreshing && refreshProgress
                    ? `Atualizando… ${refreshProgress.done}/${refreshProgress.total}`
                    : "Atualizar catálogo com IA"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onReingestFailed}
                  disabled={refreshing || ingesting || loadingSources} className="h-7 text-xs">
                  Reprocessar falhas
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onCleanCache}
                  disabled={cacheCleaning || refreshing || ingesting || loadingSources} className="h-7 text-xs">
                  {cacheCleaning ? "Limpando…" : "Limpar cache"}
                </Button>
              </div>
            )}

            <TabsList className="w-full">
              <TabsTrigger value="tree" className="flex-1">Árvore</TabsTrigger>
              <TabsTrigger value="list" className="flex-1">Lista ({sourcesCount})</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden gap-0">
            <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
              <TabsContent value="tree" className="flex-1 overflow-y-auto mt-0 px-6 py-3 space-y-3 data-[state=inactive]:hidden">
                {CATEGORY_ORDER.map((cat) => {
                  const topics = topicsByCategory[cat] || {};
                  const topicEntries = Object.entries(topics).sort((a, b) => b[1] - a[1]);
                  const total = Object.values(topics).reduce((acc, n) => acc + n, 0);
                  if (!total) return null;
                  return (
                    <div key={cat} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{CATEGORY_LABELS[cat]}</p>
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => { onCategoryFilterChange(cat); onTopicFilterChange("ALL"); onTabChange("list"); }}>
                          Ver ({total})
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {topicEntries.map(([topicKey, count]) => (
                          <Button key={`${cat}:${topicKey}`} type="button" variant="outline" size="sm" className="h-8"
                            onClick={() => { onCategoryFilterChange(cat); onTopicFilterChange(topicKey); onTabChange("list"); }}>
                            {TOPIC_LABELS[topicKey] || topicKey}{" "}
                            <span className="ml-1 text-muted-foreground">({count})</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </TabsContent>

              <TabsContent value="list" className="flex-1 overflow-y-auto mt-0 px-6 py-3 data-[state=inactive]:hidden">
                {loadingSources && (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando catálogo…
                  </div>
                )}
                {!loadingSources && sources.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4">Nenhum material encontrado com esses filtros.</p>
                )}
                <div className="space-y-2">
                  {sources.map((s) => {
                    const active = s.id === previewId;
                    const isInChat = s.id === selectedSourceId && !oracleMode;
                    const isPublic = isPublicSource(s) || isFixedSource(s);
                    const visibilityLabel = isFixedSource(s) ? "FIXO" : isPublic ? "PÚBLICO" : "PRIVADO";
                    const topicKey = getSourceTopicKey(s);
                    const topicLabel = topicKey ? TOPIC_LABELS[topicKey] || topicKey : "";
                    const meta = getSourceMeta(s);
                    const subtitle = String(meta?.ai?.subtitle || meta?.subtitle || "").trim();
                    const ingestFailed = s.ingest_status === "failed";
                    const reingesting = reingestingSourceId === s.id;
                    const canDelete = !isFixedSource(s) && (isStaff || (userId && s.user_id === userId));
                    const tags = getSourceTags(s);
                    const outline = (() => {
                      const m = getSourceMeta(s);
                      const o = m?.ai?.outline || m?.outline || [];
                      return Array.isArray(o) ? o : [];
                    })();

                    return (
                      <div key={s.id}
                        className={["w-full rounded-md border text-left transition-colors",
                          active ? "border-primary bg-primary/5" : "hover:bg-muted/40"].join(" ")}>
                        <button type="button" className="w-full text-left px-3 pt-3 pb-2"
                          onClick={() => onPreviewIdChange(active ? null : s.id)}
                          aria-label={`${active ? "Fechar" : "Expandir"} ${s.title?.trim() || "material"}`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-sm leading-snug flex-1 min-w-0 truncate">{s.title?.trim() || "Sem título"}</p>
                            {isInChat && <Badge className="text-[10px] shrink-0">em uso</Badge>}
                          </div>
                          {subtitle && <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{subtitle}</p>}
                          {!active && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{displaySummary(s)}</p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="text-[10px]">{visibilityLabel}</Badge>
                            <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[getSourceCategoryKey(s)] || "Outros"}</Badge>
                            {topicLabel && <Badge variant="outline" className="text-[10px]">{topicLabel}</Badge>}
                            {statusBadge(s)}
                          </div>
                          {tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {tags.slice(0, active ? undefined : 4).map((tag) => (
                                <span key={tag} className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
                              ))}
                              {!active && tags.length > 4 && (
                                <span className="text-[10px] text-muted-foreground">+{tags.length - 4}</span>
                              )}
                            </div>
                          )}
                        </button>

                        {active && (
                          <div className="px-3 pb-3 space-y-2 border-t mt-0 pt-2">
                            {ingestFailed && s.ingest_error && (
                              <p className="text-[11px] text-red-500/90">{String(s.ingest_error).slice(0, 200)}</p>
                            )}
                            {s.summary && (
                              <p className="text-xs text-muted-foreground whitespace-pre-line">{s.summary.trim()}</p>
                            )}
                            {outline.length > 0 && (
                              <div className="border rounded-md p-2 bg-muted/30">
                                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Índice</p>
                                {renderOutline(outline)}
                              </div>
                            )}
                            <div className="flex items-center gap-1 flex-wrap pt-1">
                              {s.url && (
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs"
                                  onClick={() => window.open(s.url!, "_blank", "noreferrer")}>Abrir</Button>
                              )}
                              <Button type="button" size="sm" className="h-7 px-2 text-xs"
                                onClick={() => onSelectSource(s)}
                                disabled={s.ingest_status === "pending" || (s.ingest_status === "failed" && s.id !== FIXED_RULES_ID)}>
                                Usar no chat
                              </Button>
                              {studioAccess && s.id !== FIXED_RULES_ID && (
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs"
                                  onClick={() => onNavigateToQuiz(s.id)}>Criar quiz</Button>
                              )}
                              {!isFixedSource(s) && ingestFailed && (
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs"
                                  disabled={reingesting || Boolean(reingestingSourceId) || refreshing || ingesting}
                                  onClick={() => onReingestSource(s.id)}>
                                  {reingesting ? "Reprocessando…" : "Reprocessar"}
                                </Button>
                              )}
                              {canDelete && (
                                <Button type="button" variant="ghost" size="icon"
                                  className="h-7 w-7 ml-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                                  title="Apagar material" onClick={() => onDeleteSource(s.id)}
                                  disabled={refreshing || ingesting || Boolean(reingestingSourceId)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        {!active && (
                          <div className="px-3 pb-2 flex items-center gap-1">
                            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs"
                              onClick={() => onSelectSource(s)}
                              disabled={s.ingest_status === "pending" || (s.ingest_status === "failed" && s.id !== FIXED_RULES_ID)}>
                              Usar
                            </Button>
                            {canDelete && (
                              <Button type="button" variant="ghost" size="icon"
                                className="h-6 w-6 ml-auto text-muted-foreground hover:text-destructive"
                                title="Apagar material" onClick={() => onDeleteSource(s.id)}
                                disabled={refreshing || ingesting || Boolean(reingestingSourceId)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </div>

            {previewSource ? (
              <div className="hidden sm:flex flex-col w-72 xl:w-80 shrink-0 border-l overflow-y-auto px-4 py-3 gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" size="icon" className="h-7 w-7"
                      disabled={!previewPrevId} title="Anterior"
                      onClick={() => previewPrevId && onPreviewIdChange(previewPrevId)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" className="h-7 w-7"
                      disabled={!previewNextId} title="Próximo"
                      onClick={() => previewNextId && onPreviewIdChange(previewNextId)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                    {previewIndex >= 0 && (
                      <span className="text-[11px] text-muted-foreground ml-1">
                        {previewIndex + 1}/{sourcesCount}
                      </span>
                    )}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => onPreviewIdChange(null)} title="Fechar prévia">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div>
                  <p className="font-medium text-sm">{previewSource.title?.trim() || "Sem título"}</p>
                  {previewSource.summary && (
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{previewSource.summary}</p>
                  )}
                </div>

                {previewSource.ingest_status === "failed" && previewSource.id !== FIXED_RULES_ID && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-red-500/20 p-2">
                    <p className="text-xs text-red-500/90">Falhou na curadoria.</p>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                      disabled={Boolean(reingestingSourceId) || refreshing || ingesting}
                      onClick={() => onReingestSource(previewSource.id)}>
                      {reingestingSourceId === previewSource.id ? "Reprocessando…" : "Reprocessar"}
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-1">
                  {previewSource.url && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => window.open(previewSource.url!, "_blank", "noreferrer")}>Abrir</Button>
                  )}
                  <Button type="button" size="sm" className="h-7 text-xs"
                    onClick={() => onSelectSource(previewSource)}
                    disabled={previewSource.ingest_status === "pending" || (previewSource.ingest_status === "failed" && previewSource.id !== FIXED_RULES_ID)}>
                    Usar no chat
                  </Button>
                  {studioAccess && previewSource.id !== FIXED_RULES_ID && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => onNavigateToQuiz(previewSource.id)}>Criar quiz</Button>
                  )}
                  {previewSource.id !== FIXED_RULES_ID && (isStaff || (userId && previewSource.user_id === userId)) && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => onDeleteSource(previewSource.id)}>Apagar</Button>
                  )}
                </div>

                {(() => {
                  const meta = previewSource.metadata && typeof previewSource.metadata === "object"
                    ? previewSource.metadata : null;
                  const outline = meta?.ai?.outline || meta?.outline || [];
                  if (!Array.isArray(outline) || outline.length === 0) return null;
                  return <div className="border-t pt-2">{renderOutline(outline)}</div>;
                })()}
              </div>
            ) : (
              <div className="hidden sm:flex items-center justify-center w-64 shrink-0 border-l px-4">
                <p className="text-xs text-muted-foreground text-center">Clique em um material para ver detalhes.</p>
              </div>
            )}
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
