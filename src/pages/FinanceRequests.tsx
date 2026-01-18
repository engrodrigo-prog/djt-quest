import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { ThemedBackground } from "@/components/ThemedBackground";
import Navigation from "@/components/Navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, FileText, Plus, XCircle } from "lucide-react";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { FINANCE_COMPANIES, FINANCE_COORDINATIONS, FINANCE_EXPENSE_TYPES, FINANCE_REQUEST_KINDS, FINANCE_STATUSES } from "@/lib/finance/constants";

type RequestRow = {
  id: string;
  protocol: string;
  created_at: string;
  updated_at: string;
  company: string;
  training_operational: boolean;
  request_kind: string;
  expense_type: string;
  coordination: string;
  date_start: string;
  date_end: string | null;
  amount_cents: number | null;
  currency: string;
  status: string;
  last_observation: string | null;
};

type AttachmentItem = {
  url: string;
  storageBucket?: string;
  storagePath?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  meta?: any;
};

type DraftItem = {
  id: string;
  expenseType: string;
  amountBrl: string;
  description: string;
  attachments: AttachmentItem[];
  uploading: boolean;
};

const EMPTY_FORM = {
  company: "",
  trainingOperational: "",
  requestKind: "",
  coordination: "",
  dateStart: "",
  dateEnd: "",
  description: "",
} as const;

const PREFILL_ENABLED_KEY = "finance_prefill_enabled";
const LAST_COMPANY_KEY = "finance_last_company";
const LAST_COORDINATION_KEY = "finance_last_coordination";

const isGuestTeamId = (raw: any) => String(raw || "").trim().toUpperCase() === "CONVIDADOS";
const isGuestProfile = (p: any, roles: string[] = []) =>
  roles.includes("invited") || isGuestTeamId(p?.sigla_area) || isGuestTeamId(p?.operational_base);

const normalizeLoose = (raw: any) =>
  String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const matchFromList = (raw: any, list: readonly string[]) => {
  const key = normalizeLoose(raw);
  if (!key) return "";
  for (const item of list) {
    if (normalizeLoose(item) === key) return item;
  }
  for (const item of list) {
    const k = normalizeLoose(item);
    if (k && (k.includes(key) || key.includes(k))) return item;
  }
  return "";
};

const formatBrl = (cents: number | null | undefined) => {
  const n = typeof cents === "number" ? cents / 100 : 0;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export default function FinanceRequests() {
  const { user, profile, roles, orgScope } = useAuth() as any;
  const { toast } = useToast();
  const [items, setItems] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");

  const [newOpen, setNewOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [extractingAi, setExtractingAi] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [aiExtractingByPath, setAiExtractingByPath] = useState<Record<string, boolean>>({});
  const [prefillEnabled, setPrefillEnabled] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return true;
      const v = window.localStorage.getItem(PREFILL_ENABLED_KEY);
      if (v == null) return true;
      return v === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(PREFILL_ENABLED_KEY, prefillEnabled ? "1" : "0");
    } catch {
      // ignore
    }
  }, [prefillEnabled]);

  const applyPrefill = useCallback(() => {
    let lastCompany = "";
    let lastCoord = "";
    try {
      if (typeof window !== "undefined") {
        lastCompany = matchFromList(window.localStorage.getItem(LAST_COMPANY_KEY), FINANCE_COMPANIES);
        lastCoord = matchFromList(window.localStorage.getItem(LAST_COORDINATION_KEY), FINANCE_COORDINATIONS);
      }
    } catch {
      // ignore
    }

    const suggestedCompany =
      matchFromList((profile as any)?.company, FINANCE_COMPANIES) ||
      matchFromList((profile as any)?.empresa, FINANCE_COMPANIES) ||
      lastCompany ||
      FINANCE_COMPANIES[0] ||
      "";

    const suggestedCoord =
      matchFromList(orgScope?.coordName, FINANCE_COORDINATIONS) ||
      matchFromList((profile as any)?.team?.name, FINANCE_COORDINATIONS) ||
      matchFromList(profile?.sigla_area, FINANCE_COORDINATIONS) ||
      matchFromList(profile?.operational_base, FINANCE_COORDINATIONS) ||
      lastCoord ||
      "";

    setForm((p) => ({
      ...p,
      company: p.company || suggestedCompany || "",
      coordination: p.coordination || suggestedCoord || "",
    }));
  }, [orgScope?.coordName, profile?.operational_base, profile?.sigla_area, profile]);

  useEffect(() => {
    if (!newOpen) return;
    if (!prefillEnabled) return;
    applyPrefill();
  }, [applyPrefill, newOpen, prefillEnabled]);

  const canUse = useMemo(() => {
    const roleList = Array.isArray(roles) ? roles : [];
    return Boolean(user?.id) && !isGuestProfile(profile, roleList);
  }, [profile, roles, user?.id]);

  const kickAiExtractForUploadedAttachment = useCallback(async (draftItemId: string, att: AttachmentItem) => {
    const bucket = String(att?.storageBucket || "").trim();
    const path = String(att?.storagePath || "").trim();
    const url = String(att?.url || "").trim();
    if (!bucket || !path || !url) return;

    const meta = att?.meta && typeof att.meta === "object" ? att.meta : {};
    const ai = meta?.ai_extract_json && typeof meta.ai_extract_json === "object" ? meta.ai_extract_json : null;
    const aiStatus = String(ai?.status || "").trim().toLowerCase();
    if (ai?.url) return;
    if (aiStatus === "processing") return;
    if (aiExtractingByPath[path]) return;

    setAiExtractingByPath((p) => ({ ...p, [path]: true }));
    try {
      // Mark local state as processing (doesn't block submitting).
      setDraftItems((prev) =>
        prev.map((x) => {
          if (x.id !== draftItemId) return x;
          return {
            ...x,
            attachments: (x.attachments || []).map((a) => {
              if (String(a?.storagePath || "").trim() !== path) return a;
              const nextMeta = a?.meta && typeof a.meta === "object" ? { ...a.meta } : {};
              const prevAi = nextMeta?.ai_extract_json && typeof nextMeta.ai_extract_json === "object" ? nextMeta.ai_extract_json : {};
              nextMeta.ai_extract_json = {
                ...prevAi,
                status: "processing",
                started_at: new Date().toISOString(),
                error: null,
              };
              return { ...a, meta: nextMeta };
            }),
          };
        }),
      );

      const resp = await apiFetch("/api/finance-attachment-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-UI": "silent" },
        body: JSON.stringify({
          url,
          storageBucket: bucket,
          storagePath: path,
          filename: att?.filename || null,
          contentType: att?.contentType || null,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao analisar anexo (IA)");

      const aiMeta = json?.ai_extract_json && typeof json.ai_extract_json === "object" ? json.ai_extract_json : null;
      if (!aiMeta?.storage_path) throw new Error("Resposta inválida do processamento (IA)");

      setDraftItems((prev) =>
        prev.map((x) => {
          if (x.id !== draftItemId) return x;
          return {
            ...x,
            attachments: (x.attachments || []).map((a) => {
              if (String(a?.storagePath || "").trim() !== path) return a;
              const nextMeta = a?.meta && typeof a.meta === "object" ? { ...a.meta } : {};
              nextMeta.ai_extract_json = { ...aiMeta, status: "done" };
              return { ...a, meta: nextMeta };
            }),
          };
        }),
      );
    } catch (e: any) {
      setDraftItems((prev) =>
        prev.map((x) => {
          if (x.id !== draftItemId) return x;
          return {
            ...x,
            attachments: (x.attachments || []).map((a) => {
              if (String(a?.storagePath || "").trim() !== path) return a;
              const nextMeta = a?.meta && typeof a.meta === "object" ? { ...a.meta } : {};
              const prevAi = nextMeta?.ai_extract_json && typeof nextMeta.ai_extract_json === "object" ? nextMeta.ai_extract_json : {};
              nextMeta.ai_extract_json = {
                ...prevAi,
                status: "error",
                error: e?.message || "Falha ao analisar anexo (IA)",
                failed_at: new Date().toISOString(),
              };
              return { ...a, meta: nextMeta };
            }),
          };
        }),
      );
    } finally {
      setAiExtractingByPath((p) => {
        const next = { ...p };
        delete next[path];
        return next;
      });
    }
  }, [aiExtractingByPath, setDraftItems]);

  const handleDraftItemAttachmentsChange = useCallback((draftItemId: string, items: any) => {
    const list: AttachmentItem[] = Array.isArray(items) ? (items as any) : [];
    setDraftItems((prev) => prev.map((x) => x.id === draftItemId ? { ...x, attachments: list } : x));

    // As soon as the attachment is uploaded, run AI extraction in background.
    const first = list[0];
    if (first?.url && first?.storageBucket && first?.storagePath) {
      void kickAiExtractForUploadedAttachment(draftItemId, first);
    }
  }, [kickAiExtractForUploadedAttachment]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (kindFilter && kindFilter !== "all") params.set("request_kind", kindFilter);
      params.set("limit", "200");
      const resp = await apiFetch(`/api/finance-requests?${params.toString()}`);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar solicitações");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setItems([]);
      toast({ title: "Erro", description: e?.message || "Falha ao carregar", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter, toast, user?.id]);

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
    } catch (e: any) {
      setDetail(null);
      toast({ title: "Erro", description: e?.message || "Falha ao carregar", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setDraftItems([]);
  };

  const submitNew = async () => {
    if (!canUse) return;
    if (submitting) return;
    if (!form.company) {
      toast({ title: "Empresa obrigatória", variant: "destructive" });
      return;
    }
    if (!form.trainingOperational) {
      toast({ title: "Treinamento Operacional obrigatório", variant: "destructive" });
      return;
    }
    if (!form.requestKind) {
      toast({ title: "Tipo Solicitação obrigatório", variant: "destructive" });
      return;
    }
    if (!form.coordination) {
      toast({ title: "Coordenação obrigatória", variant: "destructive" });
      return;
    }
    if (!form.dateStart) {
      toast({ title: "Data Início obrigatória", variant: "destructive" });
      return;
    }
    if (!form.description.trim() || form.description.trim().length < 10) {
      toast({ title: "Descrição obrigatória", description: "Explique com mais detalhes (mín. 10 caracteres).", variant: "destructive" });
      return;
    }
    const anyUploading = draftItems.some((it) => Boolean(it.uploading));
    if (anyUploading) {
      toast({ title: "Aguarde o upload", description: "Estamos concluindo o envio dos anexos antes de enviar.", variant: "default" });
      return;
    }

    if (form.requestKind === "Reembolso") {
      if (!draftItems.length) {
        toast({ title: "Adicione ao menos 1 comprovante", variant: "destructive" });
        return;
      }
      for (let i = 0; i < draftItems.length; i += 1) {
        const it = draftItems[i];
        if (!it?.expenseType) {
          toast({ title: "Tipo obrigatório", description: `Selecione o tipo do item #${i + 1}.`, variant: "destructive" });
          return;
        }
        if (!it?.amountBrl?.trim()) {
          toast({ title: "Valor obrigatório", description: `Informe o valor do item #${i + 1}.`, variant: "destructive" });
          return;
        }
        const atts = Array.isArray(it?.attachments) ? it.attachments : [];
        if (!atts.length) {
          toast({ title: "Anexo obrigatório", description: `Envie o comprovante do item #${i + 1}.`, variant: "destructive" });
          return;
        }
      }
    }

    if (form.requestKind === "Adiantamento") {
      if (!draftItems.length) {
        toast({ title: "Adicione ao menos 1 motivo", variant: "destructive" });
        return;
      }
      for (let i = 0; i < draftItems.length; i += 1) {
        const it = draftItems[i];
        if (!String(it?.description || "").trim()) {
          toast({ title: "Motivo obrigatório", description: `Descreva o motivo do item #${i + 1}.`, variant: "destructive" });
          return;
        }
      }
    }

    try {
      setSubmitting(true);
      const payload = {
        company: form.company,
        trainingOperational: form.trainingOperational,
        requestKind: form.requestKind,
        coordination: form.coordination,
        dateStart: form.dateStart,
        dateEnd: form.dateEnd || null,
        description: form.description,
        items: draftItems.map((it) => ({
          expenseType: form.requestKind === "Reembolso" ? it.expenseType : "Adiantamento",
          description: it.description,
          amountBrl: it.amountBrl || null,
          attachments: form.requestKind === "Reembolso"
            ? (it.attachments || []).map((a) => ({
              url: a.url,
              filename: a.filename,
              contentType: a.contentType,
              sizeBytes: a.sizeBytes,
              storageBucket: a.storageBucket,
              storagePath: a.storagePath,
              metadata: a.meta || {},
            }))
            : [],
        })),
      };
      const resp = await apiFetch("/api/finance-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const fieldErrors = json?.details?.fieldErrors;
        const firstFieldError = fieldErrors && typeof fieldErrors === "object"
          ? Object.values(fieldErrors).flat()?.[0]
          : null;
        const message = json?.error || "Falha ao enviar solicitação";
        throw new Error(firstFieldError ? `${message}: ${String(firstFieldError)}` : message);
      }
      toast({ title: "Solicitação enviada", description: `Protocolo: ${json?.request?.protocol || "—"}` });
      try {
        if (typeof window !== "undefined") {
          if (form.company) window.localStorage.setItem(LAST_COMPANY_KEY, String(form.company));
          if (form.coordination) window.localStorage.setItem(LAST_COORDINATION_KEY, String(form.coordination));
        }
      } catch {
        // ignore
      }
      setNewOpen(false);
      try {
        const reqId = String(json?.request?.id || "").trim();
        if (reqId && form.requestKind === "Reembolso") {
          // Best-effort: extrai tabela/JSON do anexo (não bloqueia o envio).
          void apiFetch("/api/finance-request-extract", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-AI-UI": "silent" },
            body: JSON.stringify({ id: reqId }),
          }).catch(() => undefined);
        }
      } catch {
        // ignore
      }
      resetForm();
      void load();
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSubmitting(false);
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

  const canCancelSelected = Boolean(detail?.permissions?.can_cancel);
  const cancelSelected = async () => {
    const id = String(detailId || "").trim();
    if (!id) return;
    if (!window.confirm("Cancelar solicitação? (somente se ainda estiver como Enviado)")) return;
    try {
      const resp = await apiFetch("/api/finance-request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao cancelar");
      toast({ title: "Solicitação cancelada" });
      setDetailOpen(false);
      setDetailId(null);
      setDetail(null);
      void load();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao cancelar", variant: "destructive" });
    }
  };

  return (
    <div className="relative min-h-screen bg-background pb-40 overflow-hidden">
      <ThemedBackground theme="habilidades" />
      <div className="container relative mx-auto px-3 py-4 space-y-4 max-w-4xl">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold leading-tight flex-1">Solicitar Reembolso ou Adiantamento</h1>
          <Button size="sm" onClick={() => setNewOpen(true)} disabled={!canUse}>
            <Plus className="h-4 w-4 mr-2" />
            Nova solicitação
          </Button>
        </div>

        {!canUse ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Acesso indisponível</CardTitle>
              <CardDescription className="text-xs">CONVIDADOS não podem solicitar reembolso/adiantamento.</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Minhas solicitações</CardTitle>
            <CardDescription className="text-xs">
              Histórico e status das suas solicitações.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="w-full sm:w-56">
                <Label className="text-[11px] text-muted-foreground">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {FINANCE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-56">
                <Label className="text-[11px] text-muted-foreground">Tipo Solicitação</Label>
                <Select value={kindFilter} onValueChange={setKindFilter}>
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {FINANCE_REQUEST_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1" />
              <Button size="sm" variant="outline" className="h-9 self-end" onClick={() => void load()} disabled={loading}>
                {loading ? "Atualizando..." : "Atualizar"}
              </Button>
            </div>

            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma solicitação encontrada.</p>
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
                          {r.request_kind} • {r.expense_type} • {r.company} • {r.coordination}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={r.status === "Enviado" ? "secondary" : r.status === "Pago" ? "default" : "outline"} className="text-[10px]">
                          {r.status}
                        </Badge>
                        <div className="text-[11px] text-muted-foreground">{formatBrl(r.amount_cents)}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        {r.date_start}
                        {r.date_end ? ` → ${r.date_end}` : ""}
                      </span>
                      <span>{new Date(r.updated_at).toLocaleString(getActiveLocale())}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={newOpen} onOpenChange={(o) => { setNewOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0">
          <div className="px-6 pt-6">
            <DialogHeader>
              <DialogTitle>Nova solicitação</DialogTitle>
              <DialogDescription>Preencha os dados e envie sua solicitação.</DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-4">
            <div className="grid gap-3 pt-3">
              <div className="rounded-md border p-3 bg-muted/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium">Pré-preencher com meus dados</div>
                    <div className="text-[11px] text-muted-foreground">
                      Usa informações do seu cadastro (ex.: coordenação/base) e sua última escolha. Você pode alterar antes de enviar.
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 truncate">
                      {profile?.name ? `Nome: ${profile.name} • ` : ""}
                      {(profile as any)?.matricula ? `Matrícula: ${(profile as any).matricula}` : ""}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 truncate">
                      {profile?.sigla_area ? `Área: ${profile.sigla_area} • ` : ""}
                      {profile?.operational_base ? `Base: ${profile.operational_base}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button type="button" variant="outline" size="sm" onClick={applyPrefill}>
                      Preencher agora
                    </Button>
                    <Switch checked={prefillEnabled} onCheckedChange={(v) => setPrefillEnabled(Boolean(v))} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Empresa</Label>
                  <Select value={form.company} onValueChange={(v) => setForm((p) => ({ ...p, company: v as any }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {FINANCE_COMPANIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Treinamento Operacional</Label>
                  <Select value={form.trainingOperational} onValueChange={(v) => setForm((p) => ({ ...p, trainingOperational: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Não">Não</SelectItem>
                      <SelectItem value="Sim">Sim</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Tipo Solicitação</Label>
                  <Select
                    value={form.requestKind}
                    onValueChange={(v) => {
                      const next = v as any;
                      setForm((p) => ({ ...p, requestKind: next }));
                      setDraftItems(() => {
                        if (next === "Reembolso") {
                          return [
                            {
                              id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                              expenseType: "",
                              amountBrl: "",
                              description: "",
                              attachments: [],
                              uploading: false,
                            },
                          ];
                        }
                        if (next === "Adiantamento") {
                          return [
                            {
                              id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                              expenseType: "Adiantamento",
                              amountBrl: "",
                              description: "",
                              attachments: [],
                              uploading: false,
                            },
                          ];
                        }
                        return [];
                      });
                    }}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {FINANCE_REQUEST_KINDS.map((k) => (<SelectItem key={k} value={k}>{k}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>

                {form.requestKind === "Reembolso" ? (
                  <div className="rounded-md border p-3 bg-muted/20">
                    <div className="text-[12px] font-medium">Reembolso</div>
                    <div className="text-[11px] text-muted-foreground">Adicione 1+ itens, cada um com valor e comprovante.</div>
                  </div>
                ) : form.requestKind === "Adiantamento" ? (
                  <div className="rounded-md border p-3 bg-muted/20">
                    <div className="text-[12px] font-medium">Adiantamento</div>
                    <div className="text-[11px] text-muted-foreground">Adicione 1+ motivos (valor opcional, sem anexos).</div>
                  </div>
                ) : (
                  <div className="rounded-md border p-3 bg-muted/10">
                    <div className="text-[12px] font-medium">Selecione o tipo</div>
                    <div className="text-[11px] text-muted-foreground">Escolha “Reembolso” ou “Adiantamento” para continuar.</div>
                  </div>
                )}
              </div>

            <div>
              <Label>Coordenação</Label>
              <Select value={form.coordination} onValueChange={(v) => setForm((p) => ({ ...p, coordination: v as any }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {FINANCE_COORDINATIONS.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Data Início</Label>
                <Input type="date" className="mt-1" value={form.dateStart} onChange={(e) => setForm((p) => ({ ...p, dateStart: e.target.value }))} />
              </div>
              <div>
                <Label>Data Fim (opcional)</Label>
                <Input type="date" className="mt-1" value={form.dateEnd} onChange={(e) => setForm((p) => ({ ...p, dateEnd: e.target.value }))} />
              </div>
            </div>

            {form.requestKind === "Reembolso" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Itens do reembolso</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDraftItems((p) => [
                        ...p,
                        {
                          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                          expenseType: "",
                          amountBrl: "",
                          description: "",
                          attachments: [],
                          uploading: false,
                        },
                      ])
                    }
                    disabled={!form.requestKind || draftItems.length >= 12}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar
                  </Button>
                </div>

                {draftItems.length ? (
                  <div className="space-y-2">
                    {draftItems.map((it, idx) => (
                      <div key={it.id} className="rounded-md border p-3 bg-muted/10 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[12px] font-medium">Item #{idx + 1}</div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setDraftItems((p) => p.filter((x) => x.id !== it.id))}
                            disabled={draftItems.length <= 1}
                          >
                            Remover
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-[11px] text-muted-foreground">Tipo</Label>
                            <Select
                              value={it.expenseType}
                              onValueChange={(v) => setDraftItems((p) => p.map((x) => x.id === it.id ? { ...x, expenseType: v } : x))}
                            >
                              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                              <SelectContent>
                                {FINANCE_EXPENSE_TYPES
                                  .filter((t) => t !== "Adiantamento")
                                  .map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">Valor (R$)</Label>
                            <Input
                              className="mt-1"
                              placeholder="Ex: 123,45"
                              value={it.amountBrl}
                              onChange={(e) => setDraftItems((p) => p.map((x) => x.id === it.id ? { ...x, amountBrl: e.target.value } : x))}
                            />
                          </div>
                        </div>

                        <div>
                          <Label className="text-[11px] text-muted-foreground">Descrição do item (opcional)</Label>
                          <Input
                            className="mt-1"
                            placeholder="Ex: Uber ida e volta"
                            value={it.description}
                            onChange={(e) => setDraftItems((p) => p.map((x) => x.id === it.id ? { ...x, description: e.target.value } : x))}
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px] text-muted-foreground">Comprovante (PDF/JPG/PNG)</Label>
                            <span className="text-[11px] text-muted-foreground">
                              {(() => {
                                if (it.uploading) return "enviando...";
                                if (!(it.attachments || []).length) return "pendente";
                                const a0 = it.attachments?.[0];
                                const ai = a0?.meta?.ai_extract_json;
                                const st = String(ai?.status || "").trim().toLowerCase();
                                if (st === "processing") return "enviado • IA lendo...";
                                if (st === "done") return "enviado • IA pronta";
                                if (st === "error") return "enviado • IA falhou";
                                return "enviado";
                              })()}
                            </span>
                          </div>
                          <AttachmentUploader
                            onAttachmentsChange={() => {}}
                            onAttachmentItemsChange={(items) => handleDraftItemAttachmentsChange(it.id, items)}
                            onUploadingChange={(u) => setDraftItems((p) => p.map((x) => x.id === it.id ? { ...x, uploading: Boolean(u) } : x))}
                            maxFiles={1}
                            maxImages={1}
                            maxVideos={0}
                            maxSizeMB={25}
                            capture="environment"
                            includeImageGpsMeta
                            bucket="evidence"
                            pathPrefix="finance-requests"
                            acceptMimeTypes={["application/pdf", "image/jpeg", "image/png", "image/webp"]}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Adicione um item para continuar.</p>
                )}
              </div>
            ) : form.requestKind === "Adiantamento" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Motivos do adiantamento</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDraftItems((p) => [
                        ...p,
                        {
                          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                          expenseType: "Adiantamento",
                          amountBrl: "",
                          description: "",
                          attachments: [],
                          uploading: false,
                        },
                      ])
                    }
                    disabled={!form.requestKind || draftItems.length >= 12}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar
                  </Button>
                </div>

                {draftItems.length ? (
                  <div className="space-y-2">
                    {draftItems.map((it, idx) => (
                      <div key={it.id} className="rounded-md border p-3 bg-muted/10 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[12px] font-medium">Item #{idx + 1}</div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setDraftItems((p) => p.filter((x) => x.id !== it.id))}
                            disabled={draftItems.length <= 1}
                          >
                            Remover
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="sm:col-span-2">
                            <Label className="text-[11px] text-muted-foreground">Motivo</Label>
                            <Input
                              className="mt-1"
                              placeholder="Ex: despesas de campo, deslocamento, etc."
                              value={it.description}
                              onChange={(e) => setDraftItems((p) => p.map((x) => x.id === it.id ? { ...x, description: e.target.value } : x))}
                            />
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">Valor (opcional)</Label>
                            <Input
                              className="mt-1"
                              placeholder="Ex: 500,00"
                              value={it.amountBrl}
                              onChange={(e) => setDraftItems((p) => p.map((x) => x.id === it.id ? { ...x, amountBrl: e.target.value } : x))}
                            />
                          </div>
                          <div className="rounded-md border p-3 bg-muted/20">
                            <div className="text-[12px] font-medium">Sem anexos</div>
                            <div className="text-[11px] text-muted-foreground">Adiantamento não exige comprovantes.</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Adicione um item para continuar.</p>
                )}
              </div>
            ) : null}

            <div>
              <Label>Descrição</Label>
              <Textarea className="mt-1 min-h-[120px]" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Descreva a solicitação..." />
            </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t bg-background">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-[11px] text-muted-foreground">
                {form.requestKind === "Reembolso"
                  ? (() => {
                    const uploading = draftItems.some((it) => Boolean(it.uploading));
                    const attachments = draftItems.reduce((acc, it) => acc + (Array.isArray(it.attachments) ? it.attachments.length : 0), 0);
                    return `Itens: ${draftItems.length} • Anexos: ${attachments}${uploading ? " (enviando...)" : ""}`;
                  })()
                  : form.requestKind === "Adiantamento"
                  ? `Itens: ${draftItems.length} • Sem anexos.`
                  : "Preencha os campos para habilitar o envio."}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={submitNew}
                  disabled={submitting || draftItems.some((it) => Boolean(it.uploading)) || !canUse}
                >
                  {submitting ? "Enviando..." : "Enviar"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={(o) => { setDetailOpen(o); if (!o) { setDetailId(null); setDetail(null);} }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes</DialogTitle>
            <DialogDescription>Protocolo e histórico de status.</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : detail?.request ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{detail.request.protocol}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {detail.request.request_kind} • {detail.request.expense_type} • {detail.request.company} • {detail.request.coordination}
                  </div>
                </div>
                <div className="text-right">
                  <Badge className="text-[11px]">{detail.request.status}</Badge>
                  <div className="text-[12px] text-muted-foreground mt-1">{formatBrl(detail.request.amount_cents)}</div>
                </div>
              </div>

              {detail.request.last_observation ? (
                <div className="rounded-md border p-2 text-[12px]">
                  <div className="font-medium">Observação</div>
                  <div className="text-muted-foreground whitespace-pre-wrap">{detail.request.last_observation}</div>
                </div>
              ) : null}

              <div className="rounded-md border p-2 text-[12px]">
                <div className="font-medium">Descrição</div>
                <div className="text-muted-foreground whitespace-pre-wrap">{detail.request.description}</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-md border p-2 text-[12px]">
                  <div className="font-medium">Período</div>
                  <div className="text-muted-foreground">{detail.request.date_start}{detail.request.date_end ? ` → ${detail.request.date_end}` : ""}</div>
                </div>
                <div className="rounded-md border p-2 text-[12px]">
                  <div className="font-medium">Treinamento Operacional</div>
                  <div className="text-muted-foreground">{detail.request.training_operational ? "Sim" : "Não"}</div>
                </div>
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
                                    <div className="text-[12px] font-medium">
                                      {it.expense_type || detail.request.expense_type || "—"}
                                    </div>
                                    {it.description ? (
                                      <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">{it.description}</div>
                                    ) : null}
                                  </div>
                                  <div className="text-[12px] text-muted-foreground flex-shrink-0">
                                    {formatBrl(it.amount_cents)}
                                  </div>
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
                {canCancelSelected ? (
                  <Button type="button" variant="destructive" onClick={cancelSelected}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancelar
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => setDetailOpen(false)}>
                  Fechar
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Selecione uma solicitação.</p>
          )}
        </DialogContent>
      </Dialog>

      <Navigation />
    </div>
  );
}
