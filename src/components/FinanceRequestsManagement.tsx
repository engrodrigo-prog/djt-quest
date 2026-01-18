import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { Download, FileText, RefreshCw, Save } from "lucide-react";
import { FINANCE_COMPANIES, FINANCE_COORDINATIONS, FINANCE_REQUEST_KINDS, FINANCE_STATUSES } from "@/lib/finance/constants";

type RequestRow = any;

const formatBrl = (cents: number | null | undefined) => {
  const n = typeof cents === "number" ? cents / 100 : 0;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export function FinanceRequestsManagement() {
  const { toast } = useToast();
  const { roles, userRole, profile } = useAuth() as any;
  const [items, setItems] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | null>(null);

  const [company, setCompany] = useState<string>("all");
  const [coordination, setCoordination] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [nextStatus, setNextStatus] = useState<string>("Enviado");
  const [observation, setObservation] = useState<string>("");
  const [extractingAi, setExtractingAi] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [purgeDeleteStorage, setPurgeDeleteStorage] = useState(true);

  const canPurge = useMemo(() => {
    const list: string[] = Array.isArray(roles) ? roles : [];
    if (list.includes("admin")) return true;
    return typeof userRole === "string" && userRole.includes("admin");
  }, [roles, userRole]);

  const canPurgeByAllowlist = useMemo(() => {
    const matricula = String(profile?.matricula || "").trim();
    if (matricula === "601555") return true;
    const key = String(profile?.name || "")
      .toLowerCase()
      .normalize("NFD")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (key.includes("rodrigo") && key.includes("nascimento")) return true;
    if (key.includes("cintia") && key.includes("veiga")) return true;
    return false;
  }, [profile?.matricula, profile?.name]);

  const canPurgeRequests = canPurge || canPurgeByAllowlist;

  const buildParams = useCallback((extra?: Record<string, string>) => {
    const params = new URLSearchParams();
    params.set("limit", "500");
    if (company !== "all") params.set("company", company);
    if (coordination !== "all") params.set("coordination", coordination);
    if (kind !== "all") params.set("request_kind", kind);
    if (status !== "all") params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    if (dateFrom) params.set("date_start_from", dateFrom);
    if (dateTo) params.set("date_start_to", dateTo);
    if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  }, [company, coordination, dateFrom, dateTo, kind, q, status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiFetch(`/api/finance-requests-admin?${buildParams().toString()}`);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setItems([]);
      toast({ title: "Erro", description: e?.message || "Falha ao carregar", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [buildParams, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (id: string) => {
    const rid = String(id || "").trim();
    if (!rid) return;
    setDetailId(rid);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const resp = await apiFetch(`/api/finance-request?id=${encodeURIComponent(rid)}`);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (resp.status === 404) {
          toast({ title: "Não encontrado", description: json?.error || "Solicitação não encontrada. Atualizando lista..." });
          setDetailOpen(false);
          setDetailId(null);
          setDetail(null);
          void load();
          return;
        }
        throw new Error(json?.error || "Falha ao carregar detalhes");
      }
      setDetail(json);
      const st = String(json?.request?.status || "Enviado");
      setNextStatus(st);
      setObservation(String(json?.request?.last_observation || ""));
    } catch (e: any) {
      setDetail(null);
      toast({ title: "Erro", description: e?.message || "Falha ao carregar", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  const download = async (fmt: "xlsx") => {
    if (exporting) return;
    setExporting(fmt);
    try {
      const url = `/api/finance-requests-admin?${buildParams({ export: fmt }).toString()}`;
      const resp = await apiFetch(url, { method: "GET" });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json?.error || "Falha ao baixar relatório");
      }
      const blob = await resp.blob();
      const cd = resp.headers.get("content-disposition") || "";
      const m = /filename=\"?([^\";]+)\"?/i.exec(cd);
      const filename = (m?.[1] || `finance-requests.${fmt}`).trim();

      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao baixar relatório", variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  const applyStatus = async () => {
    const id = String(detailId || "").trim();
    if (!id) return;
    try {
      setUpdating(true);
      const resp = await apiFetch("/api/finance-requests-admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: nextStatus, observation: observation || null }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao atualizar status");
      toast({ title: "Status atualizado" });
      setDetailOpen(false);
      setDetailId(null);
      setDetail(null);
      void load();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao atualizar", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const runAiExtractForSelected = async () => {
    const id = String(detail?.request?.id || detailId || "").trim();
    if (!id) return;
    if (extractingAi) return;
    try {
      setExtractingAi(true);
      const resp = await apiFetch("/api/finance-request-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao processar anexos");
      toast({
        title: "Processamento iniciado",
        description: `Processados: ${json?.processed ?? 0} (JSON: ${json?.processedJson ?? 0})`,
      });
      void openDetail(id);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao processar anexos", variant: "destructive" });
    } finally {
      setExtractingAi(false);
    }
  };

  const purgeSelected = async () => {
    const id = String(detail?.request?.id || detailId || "").trim();
    if (!id) return;
    if (!canPurgeRequests) return;
    if (purging) return;

    try {
      setPurging(true);
      const resp = await apiFetch("/api/finance-request", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, deleteStorage: purgeDeleteStorage }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao apagar solicitação");
      toast({
        title: "Solicitação apagada",
        description: `Removida: ${detail?.request?.protocol || id}`,
      });
      setDetailOpen(false);
      setDetailId(null);
      setDetail(null);
      setPurgeConfirmText("");
      void load();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao apagar", variant: "destructive" });
    } finally {
      setPurging(false);
    }
  };

  const totals = useMemo(() => {
    const pending = items.filter((r) => !["Pago", "Cancelado", "Reprovado"].includes(String(r.status))).length;
    const paid = items.filter((r) => String(r.status) === "Pago").length;
    const total = items
      .map((r) => Number(r?.amount_cents))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => a + b, 0);
    return { pending, paid, total };
  }, [items]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Reembolso & Adiantamento</CardTitle>
        <CardDescription className="text-xs">Gestão de solicitações com filtros e export.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-6">
          <div className="md:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Busca (nome/email)</Label>
            <Input className="h-9 mt-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex: cintia@..." />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Empresa</Label>
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {FINANCE_COMPANIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Coordenação</Label>
            <Select value={coordination} onValueChange={setCoordination}>
              <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {FINANCE_COORDINATIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Tipo Solicitação</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {FINANCE_REQUEST_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {FINANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-6">
          <div className="md:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Data Início (de)</Label>
            <Input className="h-9 mt-1" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Data Início (até)</Label>
            <Input className="h-9 mt-1" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="md:col-span-2 flex items-end gap-2">
            <Button size="sm" variant="outline" className="h-9" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {loading ? "Atualizando..." : "Aplicar"}
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => void download("xlsx")} disabled={!!exporting}>
              <Download className="h-4 w-4 mr-2" />
              {exporting === "xlsx" ? "Baixando..." : "XLSX"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">Itens: {items.length}</Badge>
          <Badge variant="outline" className="text-[10px]">Em andamento: {totals.pending}</Badge>
          <Badge variant="outline" className="text-[10px]">Pagos: {totals.paid}</Badge>
          <Badge className="text-[10px]">Total (R$): {(totals.total / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Badge>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem resultados.</p>
        ) : (
          <div className="space-y-2">
            {items.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full text-left rounded-lg border p-3 hover:bg-accent/10 transition-colors"
                onClick={() => void openDetail(r.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{r.protocol || r.id}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {r.created_by_name || "—"} • {r.created_by_email || "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {r.request_kind} • {r.expense_type} • {r.company} • {r.coordination}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className="text-[10px]">{r.status}</Badge>
                    <div className="text-[11px] text-muted-foreground">{formatBrl(r.amount_cents)}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{r.date_start}{r.date_end ? ` → ${r.date_end}` : ""}</span>
                  <span>{new Date(r.updated_at).toLocaleString(getActiveLocale())}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <Dialog open={detailOpen} onOpenChange={(o) => { setDetailOpen(o); if (!o) { setDetailId(null); setDetail(null); } }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Detalhes e Status</DialogTitle>
              <DialogDescription>Edite status/observação e baixe anexos.</DialogDescription>
            </DialogHeader>

            {detailLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : detail?.request ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{detail.request.protocol}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {detail.request.created_by_name} • {detail.request.created_by_email}
                      {detail.request.created_by_matricula ? ` • ${detail.request.created_by_matricula}` : ""}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {detail.request.request_kind} • {detail.request.expense_type} • {detail.request.company} • {detail.request.coordination}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge className="text-[11px]">{detail.request.status}</Badge>
                    <div className="text-[12px] text-muted-foreground mt-1">{formatBrl(detail.request.amount_cents)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={nextStatus} onValueChange={setNextStatus}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FINANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Observação</Label>
                    <Textarea className="mt-1 min-h-[96px]" value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Observação interna ou para o solicitante..." />
                  </div>
                </div>

                <div className="rounded-md border p-2 text-[12px]">
                  <div className="font-medium">Descrição</div>
                  <div className="text-muted-foreground whitespace-pre-wrap">{detail.request.description}</div>
                </div>

                {Array.isArray(detail.items) && detail.items.length ? (
                  <div className="rounded-md border p-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-medium">Itens</div>
                      <span className="text-[11px] text-muted-foreground">{detail.items.length} item(ns)</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {(() => {
                        const atts = Array.isArray(detail.attachments) ? detail.attachments : [];
                        const byItem = new Map<string, any[]>();
                        const unassigned: any[] = [];
                        const idxToItemId = new Map<number, string>();
                        for (const it of detail.items) {
                          const idx = Number((it as any)?.idx);
                          const id = String((it as any)?.id || "").trim();
                          if (Number.isFinite(idx) && id) idxToItemId.set(idx, id);
                        }

                        for (const a of atts) {
                          let itemId = String(a?.item_id || "").trim();
                          if (!itemId) {
                            const idx = Number(a?.metadata?.finance_item_idx);
                            const mapped = Number.isFinite(idx) ? idxToItemId.get(idx) : null;
                            if (mapped) itemId = mapped;
                          }
                          if (itemId) {
                            const list = byItem.get(itemId) || [];
                            list.push(a);
                            byItem.set(itemId, list);
                          } else {
                            unassigned.push(a);
                          }
                        }

                        return (
                          <>
                            {detail.items.map((it: any, idx: number) => {
                              const itemAtts = byItem.get(String(it?.id || "")) || [];
                              return (
                                <div key={it.id || idx} className="rounded-md border p-2 bg-muted/10">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="text-[12px] font-medium">{it.expense_type || detail.request.expense_type || "—"}</div>
                                      {it.description ? (
                                        <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">{it.description}</div>
                                      ) : null}
                                    </div>
                                    <div className="text-[12px] text-muted-foreground flex-shrink-0">{formatBrl(it.amount_cents)}</div>
                                  </div>

                                  <div className="mt-2">
                                    <div className="flex items-center justify-between">
                                      <div className="text-[11px] text-muted-foreground">Comprovantes</div>
                                      <span className="text-[11px] text-muted-foreground">{itemAtts.length} arquivo(s)</span>
                                    </div>
                                    {itemAtts.length ? (
                                      <div className="mt-1 space-y-1">
                                        {itemAtts.map((a: any) => (
                                          <div key={a.id} className="flex items-center justify-between gap-3">
                                            <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[12px] hover:underline min-w-0">
                                              <FileText className="h-4 w-4 flex-shrink-0" />
                                              <span className="truncate">{a.filename || a.url}</span>
                                            </a>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                  {a?.metadata?.ai_extract_json?.url ? (
                                    <a
                                      href={a.metadata.ai_extract_json.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[11px] text-muted-foreground hover:underline"
                                      title="Leitura do anexo (IA) em JSON"
                                    >
                                      JSON
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                                    ) : (
                                      <p className="text-[11px] text-muted-foreground mt-1">—</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {unassigned.length ? (
                              <div className="rounded-md border p-2">
                                <div className="flex items-center justify-between">
                                  <div className="text-[12px] font-medium">Anexos (sem item)</div>
                                  <span className="text-[11px] text-muted-foreground">{unassigned.length} arquivo(s)</span>
                                </div>
                                <div className="mt-2 space-y-1">
                                  {unassigned.map((a: any) => (
                                    <div key={a.id} className="flex items-center justify-between gap-3">
                                      <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[12px] hover:underline min-w-0">
                                        <FileText className="h-4 w-4 flex-shrink-0" />
                                        <span className="truncate">{a.filename || a.url}</span>
                                      </a>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                            {a?.metadata?.ai_extract_json?.url ? (
                              <a
                                href={a.metadata.ai_extract_json.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-muted-foreground hover:underline"
                                title="Leitura do anexo (IA) em JSON"
                              >
                                JSON
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                              </div>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border p-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-medium">Anexos</div>
                      <span className="text-[11px] text-muted-foreground">{(detail.attachments || []).length} arquivo(s)</span>
                    </div>
                    {(detail.attachments || []).length ? (
                      <div className="mt-2 space-y-1">
                        {(detail.attachments || []).map((a: any) => (
                          <div key={a.id} className="flex items-center justify-between gap-3">
                            <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[12px] hover:underline min-w-0">
                              <FileText className="h-4 w-4 flex-shrink-0" />
                              <span className="truncate">{a.filename || a.url}</span>
                            </a>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {a?.metadata?.ai_extract_json?.url ? (
                                <a
                                  href={a.metadata.ai_extract_json.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-muted-foreground hover:underline"
                                  title="Leitura do anexo (IA) em JSON"
                                >
                                  JSON
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-2">Sem anexos.</p>
                    )}
                  </div>
                )}

                <div className="rounded-md border p-2">
                  <div className="text-[12px] font-medium">Histórico</div>
                  {(detail.history || []).length ? (
                    <div className="mt-2 space-y-1">
                      {(detail.history || []).map((h: any) => (
                        <div key={h.id} className="text-[12px] flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-medium">{h.to_status}</span>
                            {h.observation ? <div className="text-muted-foreground whitespace-pre-wrap">{h.observation}</div> : null}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex-shrink-0">
                            {h.created_at ? new Date(h.created_at).toLocaleString(getActiveLocale()) : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-2">—</p>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  {detail.request.request_kind === "Reembolso" && (detail.attachments || []).length ? (
                    <Button type="button" variant="outline" onClick={runAiExtractForSelected} disabled={extractingAi}>
                      {extractingAi ? "Processando..." : "Gerar leitura IA"}
                    </Button>
                  ) : null}
                  {canPurgeRequests ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="destructive" disabled={purging}>
                          {purging ? "Apagando..." : "Apagar (admin)"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Apagar solicitação</AlertDialogTitle>
                          <AlertDialogDescription>
                            Remove definitivamente do banco de dados (itens, anexos e histórico). Use apenas para limpar testes/cancelados.
                          </AlertDialogDescription>
                        </AlertDialogHeader>

                        <div className="space-y-3">
                          <div className="rounded-md border p-3 text-[12px]">
                            <div className="font-medium">{detail.request.protocol || detail.request.id}</div>
                            <div className="text-muted-foreground">
                              Status atual: <span className="font-medium">{detail.request.status}</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium">Apagar arquivos do Storage</div>
                              <div className="text-[11px] text-muted-foreground">
                                Remove o anexo original e também os derivados (JSON) quando encontrados.
                              </div>
                            </div>
                            <Switch checked={purgeDeleteStorage} onCheckedChange={(v) => setPurgeDeleteStorage(Boolean(v))} />
                          </div>

                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Digite APAGAR para confirmar</Label>
                            <Input value={purgeConfirmText} onChange={(e) => setPurgeConfirmText(e.target.value)} placeholder="APAGAR" />
                          </div>
                        </div>

                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={purging}>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={purging || purgeConfirmText.trim().toUpperCase() !== "APAGAR"}
                            onClick={() => void purgeSelected()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Apagar agora
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => setDetailOpen(false)}>
                    Fechar
                  </Button>
                  <Button type="button" onClick={applyStatus} disabled={updating}>
                    <Save className="h-4 w-4 mr-2" />
                    {updating ? "Salvando..." : "Salvar"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Selecione uma solicitação.</p>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
