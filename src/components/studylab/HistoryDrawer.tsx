import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Loader2, MoreVertical, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const PINNED_KEY = "studylab_pinned_sessions";

function loadPinned(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function savePinned(ids: string[]): void {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}

export type ChatSessionSummary = {
  id: string;
  title: string | null;
  summary: string | null;
  mode: string | null;
  source_id: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export type HistoryDrawerProps = {
  sessions: ChatSessionSummary[];
  loading: boolean;
  error: string | null;
  currentSessionId: string;
  loadingSessionId: string | null;
  chatLoading: boolean;
  chatUploading: boolean;
  historyClearing: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Group = { label: string; sessions: ChatSessionSummary[] };

function toDateOnly(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupSessions(
  sessions: ChatSessionSummary[],
  pinnedIds: string[],
): Group[] {
  const todayMs = toDateOnly(new Date());
  const yesterdayMs = todayMs - 86_400_000;
  const weekAgoMs = todayMs - 7 * 86_400_000;

  const pinned: ChatSessionSummary[] = [];
  const today: ChatSessionSummary[] = [];
  const yesterday: ChatSessionSummary[] = [];
  const thisWeek: ChatSessionSummary[] = [];
  const older: ChatSessionSummary[] = [];

  for (const s of sessions) {
    if (pinnedIds.includes(s.id)) {
      pinned.push(s);
      continue;
    }
    const ms = s.updated_at ? toDateOnly(new Date(s.updated_at)) : 0;
    if (ms >= todayMs) today.push(s);
    else if (ms >= yesterdayMs) yesterday.push(s);
    else if (ms >= weekAgoMs) thisWeek.push(s);
    else older.push(s);
  }

  return [
    { label: "Fixados", sessions: pinned },
    { label: "Hoje", sessions: today },
    { label: "Ontem", sessions: yesterday },
    { label: "Esta semana", sessions: thisWeek },
    { label: "Mais antigo", sessions: older },
  ].filter((g) => g.sessions.length > 0);
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type RenameState = { id: string; current: string } | null;

function HistoryList({
  sessions,
  loading,
  error,
  currentSessionId,
  loadingSessionId,
  chatLoading,
  chatUploading,
  historyClearing,
  search,
  onSearchChange,
  onSelect,
  onNewChat,
  onDelete,
  onClearAll,
  onRename,
}: Omit<HistoryDrawerProps, "open" | "onOpenChange">) {
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinned);
  const [renameState, setRenameState] = useState<RenameState>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renameState) {
      setRenameValue(renameState.current);
      setTimeout(() => renameInputRef.current?.select(), 50);
    }
  }, [renameState]);

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      savePinned(next);
      return next;
    });
  }, []);

  const openRename = useCallback((s: ChatSessionSummary) => {
    setRenameState({
      id: s.id,
      current: String(s.title || s.summary || "").trim() || "Conversa sem título",
    });
  }, []);

  const submitRename = useCallback(async () => {
    if (!renameState || renaming) return;
    const title = renameValue.trim();
    if (!title || title === renameState.current) {
      setRenameState(null);
      return;
    }
    setRenaming(true);
    try {
      await onRename(renameState.id, title);
    } finally {
      setRenaming(false);
      setRenameState(null);
    }
  }, [onRename, renameState, renameValue, renaming]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const title = String(s.title ?? "").toLowerCase();
      const summary = String(s.summary ?? "").toLowerCase();
      return title.includes(q) || summary.includes(q);
    });
  }, [search, sessions]);

  const groups = useMemo(() => groupSessions(filtered, pinnedIds), [filtered, pinnedIds]);

  return (
    <>
      <div className="space-y-3">
        <Button
          type="button"
          className="w-full justify-start"
          onClick={onNewChat}
          disabled={chatLoading || chatUploading}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova conversa
        </Button>

        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar no histórico..."
        />

        <Button
          type="button"
          variant="outline"
          className="w-full justify-start text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50"
          onClick={onClearAll}
          disabled={
            chatLoading ||
            chatUploading ||
            loading ||
            historyClearing ||
            sessions.length === 0
          }
          title="Apagar todo o histórico"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {historyClearing ? "Apagando histórico..." : `Limpar tudo (${sessions.length})`}
        </Button>

        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando histórico...
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {error ?? "Nenhuma conversa encontrada."}
            </div>
          ) : (
            <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.sessions.map((session) => {
                      const active = currentSessionId === session.id;
                      const loading = loadingSessionId === session.id;
                      const isPinned = pinnedIds.includes(session.id);
                      const title = String(
                        session.title || session.summary || "Conversa sem título",
                      ).trim();
                      const summary = String(session.summary || "").trim();
                      return (
                        <div key={session.id} className="group flex items-start gap-1">
                          <button
                            type="button"
                            onClick={() => onSelect(session.id)}
                            className={[
                              "flex-1 min-w-0 rounded-md border p-2 text-left transition-colors",
                              active
                                ? "border-primary bg-primary/10"
                                : "hover:bg-muted/40",
                            ].join(" ")}
                          >
                            <p className="truncate text-sm font-medium">{title}</p>
                            {summary && !session.title ? null : summary ? (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                {summary}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {formatWhen(session.updated_at)}
                            </p>
                          </button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-70 hover:!opacity-100 focus-visible:opacity-70"
                                disabled={loading || chatLoading}
                              >
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">Ações</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => openRename(session)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Renomear
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => togglePin(session.id)}>
                                {isPinned ? (
                                  <>
                                    <PinOff className="mr-2 h-4 w-4" />
                                    Desafixar
                                  </>
                                ) : (
                                  <>
                                    <Pin className="mr-2 h-4 w-4" />
                                    Fixar
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => onDelete(session.id)}
                                disabled={loading || chatLoading}
                              >
                                {loading ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="mr-2 h-4 w-4" />
                                )}
                                Apagar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={renameState !== null}
        onOpenChange={(open) => { if (!open) setRenameState(null); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear conversa</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="rename-input">Novo título</Label>
            <Input
              id="rename-input"
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitRename();
                if (e.key === "Escape") setRenameState(null);
              }}
              maxLength={120}
              disabled={renaming}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameState(null)}
              disabled={renaming}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitRename()} disabled={renaming}>
              {renaming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HistoryDrawer(props: HistoryDrawerProps) {
  const { open, onOpenChange, ...listProps } = props;
  const listContent = <HistoryList {...listProps} />;

  return (
    <>
      {/* Desktop: sticky sidebar card */}
      <Card className="hidden lg:flex lg:flex-col lg:sticky lg:top-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            Histórico
          </CardTitle>
          <CardDescription>Conversas salvas automaticamente por usuário.</CardDescription>
        </CardHeader>
        <CardContent>{listContent}</CardContent>
      </Card>

      {/* Mobile: Sheet */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Histórico</SheetTitle>
            <SheetDescription>Converse de onde parou em sessões anteriores.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{listContent}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
