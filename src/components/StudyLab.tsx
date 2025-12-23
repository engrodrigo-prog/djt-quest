import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { BookOpenCheck, Link as LinkIcon, MessageCircle, AlertCircle, Trash2 } from "lucide-react";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TipDialogButton } from "@/components/TipDialogButton";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { ForumKbThemeMenu } from "@/components/ForumKbThemeMenu";
import type { ForumKbSelection } from "@/components/ForumKbThemeSelector";
import { useNavigate } from "react-router-dom";

interface StudySource {
  id: string;
  user_id: string;
  title: string;
  kind: "text" | "url" | "file" | "youtube";
  url: string | null;
  storage_path: string | null;
  summary: string | null;
  ingest_status?: "pending" | "ok" | "failed" | null;
  ingested_at?: string | null;
  ingest_error?: string | null;
  topic?: string | null;
  category?: string | null;
  scope?: "user" | "org" | string | null;
  published?: boolean | null;
  metadata?: any | null;
  is_persistent: boolean;
  created_at: string;
  last_used_at: string | null;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

const STUDY_CATEGORIES = [
  "MANUAIS",
  "PROCEDIMENTOS",
  "APOSTILAS",
  "RELATORIO_OCORRENCIA",
  "AUDITORIA_INTERNA",
  "AUDITORIA_EXTERNA",
  "OUTROS",
] as const;

type StudyCategory = (typeof STUDY_CATEGORIES)[number];
type StudyScope = "user" | "org";

const CATEGORY_LABELS: Record<StudyCategory, string> = {
  MANUAIS: "Manuais",
  PROCEDIMENTOS: "Procedimentos",
  APOSTILAS: "Apostilas",
  RELATORIO_OCORRENCIA: "Relatório de Ocorrência",
  AUDITORIA_INTERNA: "Auditoria Interna",
  AUDITORIA_EXTERNA: "Auditoria Externa",
  OUTROS: "Outros",
};

const CATEGORY_ORDER: StudyCategory[] = [
  "MANUAIS",
  "PROCEDIMENTOS",
  "APOSTILAS",
  "RELATORIO_OCORRENCIA",
  "AUDITORIA_INTERNA",
  "AUDITORIA_EXTERNA",
  "OUTROS",
];

type IncidentForm = {
  ocorrido: string;
  causaRaizModoFalha: string;
  barreirasCuidados: string;
  acoesCorretivasPreventivas: string;
  mudancasImplementadas: string;
};

const EMPTY_INCIDENT: IncidentForm = {
  ocorrido: "",
  causaRaizModoFalha: "",
  barreirasCuidados: "",
  acoesCorretivasPreventivas: "",
  mudancasImplementadas: "",
};

const normalizeCategory = (raw: unknown): StudyCategory => {
  const s = (raw || "").toString().trim().toUpperCase().replace(/\s+/g, "_");
  return (STUDY_CATEGORIES as readonly string[]).includes(s) ? (s as StudyCategory) : "OUTROS";
};

const normalizeScope = (raw: unknown): StudyScope => {
  const s = (raw || "").toString().trim().toLowerCase();
  return s === "org" ? "org" : "user";
};

export const StudyLab = ({ showOrgCatalog = false }: { showOrgCatalog?: boolean }) => {
  const { user, isLeader, studioAccess } = useAuth();
  const navigate = useNavigate();
  const [sources, setSources] = useState<StudySource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const [url, setUrl] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [newCategory, setNewCategory] = useState<StudyCategory>("OUTROS");
  const [newScope, setNewScope] = useState<StudyScope>("user");
  const [newPublished, setNewPublished] = useState(true);
  const [incident, setIncident] = useState<IncidentForm>(EMPTY_INCIDENT);
  const insertedUrlsRef = useRef<Set<string>>(new Set());

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [oracleMode, setOracleMode] = useState(true);
  const [showUploader, setShowUploader] = useState(false);
  const [polling, setPolling] = useState(false);
  const [kbEnabled, setKbEnabled] = useState(false);
  const [kbSelection, setKbSelection] = useState<ForumKbSelection | null>(null);

  useEffect(() => {
    if (showUploader) {
      insertedUrlsRef.current.clear();
    }
  }, [showUploader]);

  // Studio (liderança) costuma publicar no catálogo da organização por padrão
  useEffect(() => {
    if (!isLeader) return;
    if (!showOrgCatalog) return;
    setNewScope((prev) => (prev === "org" ? prev : "org"));
    setNewPublished((prev) => (typeof prev === "boolean" ? prev : true));
  }, [isLeader, showOrgCatalog]);

  const fetchSources = async () => {
    if (!user) return;
    try {
      setLoadingSources(true);
      const columnsV2 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, category, scope, published, metadata, is_persistent, created_at, last_used_at";
      const columnsV1 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at";

      let data: any[] | null = null;
      let error: any = null;

      const v2 = await supabase.from("study_sources").select(columnsV2).order("created_at", { ascending: false });
      data = v2.data as any[] | null;
      error = v2.error;

      // Backward-compat: se ainda não migrou a tabela, tenta sem colunas novas
      if (error && /column .*?(category|scope|published|metadata)/i.test(String(error.message || error))) {
        const v1 = await supabase.from("study_sources").select(columnsV1).order("created_at", { ascending: false });
        data = v1.data as any[] | null;
        error = v1.error;
      }

      if (error) throw error;
      const normalized = await normalizeSources((data || []) as StudySource[]);
      setSources(normalized);
      if (!selectedSourceId && normalized.length) {
        setSelectedSourceId(normalized[0].id);
      }
    } catch (e: any) {
      const msg = e?.message || "";
      if (typeof msg === "string" && msg.toLowerCase().includes("study_sources")) {
        setSources([]);
      } else {
        console.warn("StudyLab: erro ao carregar fontes", msg || e);
      }
    } finally {
      setLoadingSources(false);
    }
  };

  useEffect(() => {
    fetchSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Auto-refresh enquanto houver materiais em pendente
  useEffect(() => {
    const hasPending = sources.some((s) => s.ingest_status === "pending");
    if (!hasPending) {
      setPolling(false);
      return;
    }
    setPolling(true);
    const id = setInterval(() => {
      fetchSources();
    }, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.length, sources.map((s) => s.ingest_status).join(",")]);

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) || null,
    [selectedSourceId, sources]
  );

  const canPublishOrg = Boolean(isLeader);
  const effectiveScope: StudyScope = canPublishOrg ? newScope : "user";
  const effectivePublished = effectiveScope === "org" ? Boolean(newPublished) : false;

  const buildInsertMetadata = (category: StudyCategory) => {
    if (category !== "RELATORIO_OCORRENCIA") return {};
    const payload = {
      ocorrido: incident.ocorrido?.trim() || null,
      causa_raiz_modo_falha: incident.causaRaizModoFalha?.trim() || null,
      barreiras_cuidados: incident.barreirasCuidados?.trim() || null,
      acoes_corretivas_preventivas: incident.acoesCorretivasPreventivas?.trim() || null,
      mudancas_implementadas: incident.mudancasImplementadas?.trim() || null,
    };
    // remove chaves nulas para não poluir JSON
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === "string" && v.trim()) cleaned[k] = v.trim();
    }
    return cleaned && Object.keys(cleaned).length ? { incident: cleaned } : { incident: {} };
  };

  const validateBeforeInsert = (category: StudyCategory) => {
    if (category !== "RELATORIO_OCORRENCIA") return null;
    if (!incident.ocorrido.trim()) return "Relatório de ocorrência: descreva o que aconteceu.";
    if (!incident.causaRaizModoFalha.trim()) return "Relatório de ocorrência: informe causa raiz e/ou modo de falha.";
    return null;
  };

  const deriveTitleFromUrl = (link: string) => {
    try {
      const parsed = new URL(link);
      const host = parsed.hostname.replace(/^www\./, "");
      const lastSegment = parsed.pathname.split("/").filter(Boolean).pop() || "";
      if (!lastSegment) return host;
      // Tenta extrair um nome amigável de arquivos como "GED-22 - Ocupação de Faixa de Linha de Transmissão_0.pdf"
      const cleaned = lastSegment
        .replace(/\.[^.]+$/, "")
        .replace(/[_\-]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!cleaned) return host;
      const pretty = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      return `${pretty}`;
    } catch {
      return link;
    }
  };

  const deriveSummaryFromUrl = (link: string) => {
    try {
      const parsed = new URL(link);
      const host = parsed.hostname.replace(/^www\./, "");
      const title = deriveTitleFromUrl(link);
      return `Material de estudo "${title}" do site ${host}.`;
    } catch {
      return "Material de estudo carregado a partir de um link.";
    }
  };

  const deriveTitleFromFile = (pathOrUrl: string) => {
    const name = pathOrUrl.split("/").pop() || pathOrUrl;
    const base = name.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ");
    return base.charAt(0).toUpperCase() + base.slice(1);
  };

  const deriveSummaryFromFile = (pathOrUrl: string) => {
    const ext = (pathOrUrl.split(".").pop() || "").toUpperCase();
    return `Documento (${ext || "ARQ"}) enviado para estudo.`;
  };

  const normalizeSources = async (rows: StudySource[]): Promise<StudySource[]> => {
    const updates: Partial<StudySource & { id: string }>[] = [];

    const normalized = rows.map((s) => {
      let title = s.title;
      let summary = s.summary;

      if (!title?.trim()) {
        title =
          s.kind === "file"
            ? deriveTitleFromFile(s.url || s.storage_path || "Documento")
            : deriveTitleFromUrl(s.url || "");
      }

      if (!summary?.trim()) {
        summary =
          s.kind === "file"
            ? deriveSummaryFromFile(s.url || s.storage_path || "")
            : deriveSummaryFromUrl(s.url || "");
      }

      if ((title !== s.title || summary !== s.summary) && user && s.user_id === user.id) {
        updates.push({ id: s.id, title, summary });
      }

      return { ...s, title, summary };
    });

    if (updates.length) {
      try {
        await supabase.from("study_sources").upsert(updates as any);
      } catch {
        /* se falhar, seguimos com dados normalizados apenas em memória */
      }
    }

    return normalized;
  };

  const extractFileInfo = (url: string) => {
    const name = url.split("/").pop() || url;
    const base = name.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ");
    return {
      title: base.charAt(0).toUpperCase() + base.slice(1),
      summary: deriveSummaryFromFile(url),
    };
  };

  const handleFilesUploaded = async (urls: string[]) => {
    if (!user || !urls.length) return;
    const category = normalizeCategory(newCategory);
    const validationError = validateBeforeInsert(category);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const existingUrls = new Set((sources || []).map((s) => s.url).filter(Boolean) as string[]);
    const freshUrls = urls.filter((u) => u && !existingUrls.has(u) && !insertedUrlsRef.current.has(u));
    if (!freshUrls.length) return;

    // Evita duplicar em chamadas repetidas do AttachmentUploader (ele reemite a lista completa)
    for (const u of freshUrls) insertedUrlsRef.current.add(u);

    setAdding(true);
    try {
      const metadata = buildInsertMetadata(category);
      const inserts = freshUrls.map((u) => {
        const info = extractFileInfo(u);
        return {
          user_id: user.id,
          title: info.title,
          kind: "file",
          url: u,
          summary: info.summary,
          ingest_status: "pending",
          is_persistent: true,
          last_used_at: new Date().toISOString(),
          category,
          scope: effectiveScope,
          published: effectivePublished,
          metadata,
        };
      });

      const selectV2 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, category, scope, published, metadata, is_persistent, created_at, last_used_at";
      const selectV1 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at";

      let data: any[] | null = null;
      let error: any = null;

      const v2 = await supabase.from("study_sources").insert(inserts as any).select(selectV2);
      data = v2.data as any[] | null;
      error = v2.error;

      // Backward-compat: tabela ainda sem colunas novas
      if (error && /column .*?(category|scope|published|metadata)/i.test(String(error.message || error))) {
        const legacyInserts = inserts.map(({ category: _c, scope: _s, published: _p, metadata: _m, ...rest }) => rest);
        const v1 = await supabase.from("study_sources").insert(legacyInserts as any).select(selectV1);
        data = v1.data as any[] | null;
        error = v1.error;
      }

      if (error) throw error;
      if (data && Array.isArray(data)) {
        const list = data as StudySource[];
        setSources((prev) => [...list, ...prev]);
        setSelectedSourceId(list[0]?.id || selectedSourceId);

        // Disparar ingestão IA para cada novo documento
        try {
          const { data: session } = await supabase.auth.getSession();
          const token = session.session?.access_token;
          if (token) {
            setIngesting(true);
            await Promise.all(
              list.map((s) =>
                fetch("/api/ai?handler=study-chat", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ mode: "ingest", source_id: s.id }),
                }).catch(() => undefined)
              )
            );
            // recarrega catálogo com títulos/resumos/categorias atualizados
            fetchSources();
          }
        } catch {
          // ingestão é best-effort; chat ainda faz fallback se faltar full_text
        } finally {
          setIngesting(false);
        }

        toast.success("Documentos adicionados e enviados para análise da IA.");
      }
    } catch (e: any) {
      for (const u of freshUrls) insertedUrlsRef.current.delete(u);
      toast.error(e?.message || "Não foi possível adicionar o documento.");
    } finally {
      setAdding(false);
    }
  };

  const handleSelectSource = async (id: string) => {
    setSelectedSourceId(id);
    try {
      await supabase.from("study_sources").update({ last_used_at: new Date().toISOString() }).eq("id", id);
    } catch {
      /* silencioso; não bloqueia UI */
    }
  };

  const handleDeleteSource = async (id: string) => {
    if (!user) {
      toast("Faça login para gerenciar materiais.");
      return;
    }
    const confirmed = window.confirm("Remover este material da sua base de estudos?");
    if (!confirmed) return;
    try {
      const { error } = await supabase.from("study_sources").delete().eq("id", id);
      if (error) throw error;
      setSources((prev) => {
        const updated = prev.filter((s) => s.id !== id);
        if (selectedSourceId === id) {
          const next =
            updated.find((s) => s.user_id === user.id) ||
            updated[0] ||
            null;
          setSelectedSourceId(next ? next.id : null);
        }
        return updated;
      });
      toast.success("Material removido do StudyLab.");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível remover o material.");
    }
  };

  const handleReprocess = async (id: string) => {
    if (!user) {
      toast("Faça login para reprocessar materiais.");
      return;
    }
    try {
      setIngesting(true);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (token) {
        await fetch("/api/ai?handler=study-chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ mode: "ingest", source_id: id }),
        }).catch(() => undefined);
        await fetchSources();
      }
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível reprocessar agora.");
    } finally {
      setIngesting(false);
    }
  };

  const handleSetPublished = async (id: string, published: boolean) => {
    if (!user) {
      toast("Faça login para gerenciar publicações.");
      return;
    }
    try {
      const { error } = await supabase.from("study_sources").update({ published }).eq("id", id);
      if (error) throw error;
      setSources((prev) => prev.map((s) => (s.id === id ? { ...s, published } : s)));
      toast.success(published ? "Publicado no catálogo da organização." : "Marcado como rascunho (somente liderança).");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível atualizar a publicação.");
    }
  };

  const handleAddSource = async () => {
    if (!user) {
      toast("Faça login para adicionar materiais.");
      return;
    }
    const link = url.trim();
    if (!link) {
      toast.error("Cole uma URL antes de adicionar.");
      return;
    }
    const category = normalizeCategory(newCategory);
    const validationError = validateBeforeInsert(category);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setAdding(true);
    try {
      const finalTitle = deriveTitleFromUrl(link);
      const finalDesc = deriveSummaryFromUrl(link);
      const metadata = buildInsertMetadata(category);

      const selectV2 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, category, scope, published, metadata, is_persistent, created_at, last_used_at";
      const selectV1 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at";

      const payload = {
        user_id: user.id,
        title: finalTitle,
        kind: "url",
        url: link,
        summary: finalDesc,
        ingest_status: "pending",
        is_persistent: true,
        last_used_at: new Date().toISOString(),
        category,
        scope: effectiveScope,
        published: effectivePublished,
        metadata,
      };

      let data: any = null;
      let error: any = null;

      const v2 = await supabase.from("study_sources").insert(payload as any).select(selectV2).maybeSingle();
      data = v2.data as any;
      error = v2.error;

      // Backward-compat
      if (error && /column .*?(category|scope|published|metadata)/i.test(String(error.message || error))) {
        const { category: _c, scope: _s, published: _p, metadata: _m, ...legacyPayload } = payload as any;
        const v1 = await supabase.from("study_sources").insert(legacyPayload).select(selectV1).maybeSingle();
        data = v1.data as any;
        error = v1.error;
      }

      if (error) throw error;
      if (data) {
        const created = data as StudySource;
        setSources((prev) => [created, ...prev]);
        setSelectedSourceId(created.id);

        // Ingestão IA imediata para a URL
        try {
          const { data: session } = await supabase.auth.getSession();
          const token = session.session?.access_token;
          if (token) {
            setIngesting(true);
            await fetch("/api/ai?handler=study-chat", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ mode: "ingest", source_id: created.id }),
            }).catch(() => undefined);
            // recarrega catálogo com novo título/resumo/categoria gerados
            fetchSources();
          }
        } catch {
          // se falhar, chat ainda tenta enriquecer depois
        } finally {
          setIngesting(false);
        }

        toast.success("Material adicionado e analisado pela IA.");
      }
      setUrl("");
      setShowUploader(false);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível adicionar o material.");
    } finally {
      setAdding(false);
    }
  };

  const handleChatSend = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    if (!user) {
      toast("Faça login para usar o chat de estudos.");
      return;
    }
    if (!oracleMode) {
      if (!selectedSourceId) {
        toast.error("Selecione um material da lista para conversar sobre ele.");
        return;
      }
      const sel = sources.find((s) => s.id === selectedSourceId);
      if (sel && sel.ingest_status === "failed") {
        toast.error("Curadoria do material falhou. Reprocessando agora...");
        setIngesting(true);
        try {
          const { data: session } = await supabase.auth.getSession();
          const token = session.session?.access_token;
          if (token) {
            await fetch("/api/ai?handler=study-chat", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ mode: "ingest", source_id: sel.id }),
            }).catch(() => undefined);
            await fetchSources();
          }
        } finally {
          setIngesting(false);
        }
        toast.error("Tente novamente após a curadoria.");
        return;
      }
    }

    const nextMessages = [...chatMessages, { role: "user", content: trimmed } as ChatMessage];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const resp = await fetch("/api/ai?handler=study-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          mode: oracleMode ? "oracle" : "study",
          ...(oracleMode ? {} : { source_id: selectedSourceId }),
          language: getActiveLocale(),
          ...(kbEnabled && kbSelection?.tags?.length
            ? { kb_tags: kbSelection.tags, kb_focus: kbSelection.label }
            : {}),
          messages: nextMessages,
        }),
      });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok || json?.success === false) {
        const err = json?.error || "Falha no chat de estudos";
        setChatError(err);
        return;
      }
      const answer = json.answer || json.content || "";
      if (!answer) {
        setChatError("A IA retornou uma resposta vazia.");
        return;
      }
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      // Atualiza último uso para manter ativo
      try {
        if (!oracleMode && selectedSourceId) {
          await supabase.from("study_sources").update({ last_used_at: new Date().toISOString() }).eq("id", selectedSourceId);
        }
      } catch {
        /* silencioso */
      }
    } catch (e: any) {
      toast(`Erro no chat de estudos: ${e?.message || e}`);
    } finally {
      setChatLoading(false);
    }
  };

  const displaySummary = (s: StudySource) => s.summary?.trim() || s.url || "Sem resumo";
  const statusBadge = (s: StudySource) => {
    if (s.ingest_status === "ok") return null;
    if (s.ingest_status === "pending")
      return (
        <div className="inline-flex items-center gap-1">
          <span className="inline-flex h-2 w-2 rounded-full bg-amber-300 animate-pulse" aria-hidden />
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-200 bg-amber-400/10">
            analisando com IA...
          </Badge>
        </div>
      );
    if (s.ingest_status === "failed")
      return (
        <div className="inline-flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] border-red-400 text-red-200 bg-red-500/10">
            falhou
          </Badge>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6 text-[11px] border-white/40 text-white"
            onClick={(e) => {
              e.stopPropagation();
              handleReprocess(s.id);
            }}
          >
            Tentar novamente
          </Button>
        </div>
      );
    return null;
  };

  const TOPIC_LABELS: Record<string, string> = {
    LINHAS: "Linhas de Transmissão",
    SUBESTACOES: "Subestações",
    PROCEDIMENTOS: "Procedimentos",
    PROTECAO: "Proteção",
    AUTOMACAO: "Automação",
    TELECOM: "Telecom",
    SEGURANCA_DO_TRABALHO: "Segurança do Trabalho",
    OUTROS: "Outros assuntos",
  };

  const canManageSource = (s: StudySource) => {
    if (!user) return false;
    const scope = normalizeScope(s.scope);
    if (scope === "org") return canPublishOrg;
    return s.user_id === user.id;
  };

  const matchesSearch = (s: StudySource, q: string) => {
    const hay = [
      s.title || "",
      s.summary || "",
      s.url || "",
      normalizeCategory(s.category),
      s.topic || "",
      TOPIC_LABELS[(s.topic || "").toUpperCase().replace(/\s+/g, "_")] || "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };

  const mySources = useMemo(() => {
    if (!user) return [];
    return sources.filter((s) => s.user_id === user.id && normalizeScope(s.scope) === "user");
  }, [sources, user]);

  const orgSources = useMemo(() => {
    if (!showOrgCatalog) return [];
    return sources.filter((s) => normalizeScope(s.scope) === "org");
  }, [sources, showOrgCatalog]);

  const q = search.trim().toLowerCase();
  const filteredMySources = useMemo(() => (q ? mySources.filter((s) => matchesSearch(s, q)) : mySources), [q, mySources]);
  const filteredOrgSources = useMemo(() => (q ? orgSources.filter((s) => matchesSearch(s, q)) : orgSources), [q, orgSources]);

  const groupByCategory = (list: StudySource[]) => {
    const groups: Partial<Record<StudyCategory, StudySource[]>> = {};
    for (const s of list) {
      const key = normalizeCategory(s.category);
      if (!groups[key]) groups[key] = [];
      groups[key]!.push(s);
    }
    return groups;
  };

  const myByCategory = groupByCategory(filteredMySources);
  const orgByCategory = groupByCategory(filteredOrgSources);

  const visibleSources = useMemo(
    () => [...filteredMySources, ...filteredOrgSources],
    [filteredMySources, filteredOrgSources]
  );

  // Se o usuário filtrou/ocultou a seleção atual, seleciona o primeiro item visível.
  useEffect(() => {
    if (!visibleSources.length) {
      if (selectedSourceId) setSelectedSourceId(null);
      return;
    }
    if (!selectedSourceId) {
      setSelectedSourceId(visibleSources[0].id);
      return;
    }
    if (!visibleSources.some((s) => s.id === selectedSourceId)) {
      setSelectedSourceId(visibleSources[0].id);
    }
  }, [selectedSourceId, visibleSources]);

  return (
    <div className="space-y-6">
      {ingesting && (
        <div className="rounded-md border border-white/30 bg-white/5 px-4 py-2 flex items-center gap-3 text-xs text-white">
          <span className="inline-flex h-3 w-3 rounded-full bg-primary animate-pulse" aria-hidden />
          <div className="flex-1">
            <p className="font-medium">Importando e analisando conteúdo...</p>
            <div className="mt-1 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-2/3 bg-primary/80 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* Catálogo único acima: seus materiais + (opcional) organização */}
      <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <CardTitle className="text-white">StudyLab • Base de conhecimento</CardTitle>
            <TipDialogButton
              tipId="studylab-oracle"
              ariaLabel="Entenda o StudyLab"
              className="inline-flex items-center justify-center rounded-full border border-white/20 bg-black/20 p-1 text-blue-100/80 hover:bg-black/30 hover:text-blue-50"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="Observação" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/30 text-white/80 hover:border-white/60">
                    <AlertCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Materiais sem uso por 30 dias podem sair do catálogo (para manter a base enxuta).</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex-1" />
            <Button
              type="button"
              variant={showUploader ? "secondary" : "default"}
              className={showUploader ? "text-white bg-primary hover:bg-primary/90" : "border-white/40 text-white bg-primary/80 hover:bg-primary"}
              onClick={() => setShowUploader((v) => !v)}
            >
              {showUploader ? "Fechar" : "Adicionar material"}
            </Button>
          </div>
          <CardDescription className="text-white/80">
            Salve manuais, procedimentos, relatórios e imagens. Depois, pergunte ao Oráculo para transformar isso em aprendizados, fóruns e quizzes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-h-[520px] overflow-y-auto text-white">
          {showUploader && (
            <div className="rounded-lg border border-white/20 bg-white/5 p-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-white">Catalogar como</Label>
                  <Select value={newCategory} onValueChange={(v) => setNewCategory(normalizeCategory(v))}>
                    <SelectTrigger className="text-white">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_ORDER.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {canPublishOrg && (
                  <div className="space-y-2">
                    <Label className="text-white">Destino</Label>
                    <Select value={effectiveScope} onValueChange={(v) => setNewScope(normalizeScope(v))}>
                      <SelectTrigger className="text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">Meu StudyLab (privado)</SelectItem>
                        <SelectItem value="org">Catálogo da organização</SelectItem>
                      </SelectContent>
                    </Select>

                    {effectiveScope === "org" && (
                      <div className="flex items-center justify-between rounded-md border border-white/20 bg-white/5 px-3 py-2">
                        <div>
                          <p className="text-xs font-medium text-white">Publicado</p>
                          <p className="text-[11px] text-white/70">Visível para todos no StudyLab.</p>
                        </div>
                        <Switch checked={newPublished} onCheckedChange={setNewPublished} />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {newCategory === "RELATORIO_OCORRENCIA" && (
                <div className="rounded-md border border-white/20 bg-white/5 p-3 space-y-3">
                  <p className="text-xs text-white/80">
                    Relatório de ocorrência: responda (até 5) para capturar causas, modos de falha e aprendizados.
                  </p>
                  <div className="grid gap-3">
                    <div className="space-y-1">
                      <Label className="text-white">1) O que aconteceu? *</Label>
                      <Textarea
                        value={incident.ocorrido}
                        onChange={(e) => setIncident((prev) => ({ ...prev, ocorrido: e.target.value }))}
                        rows={3}
                        placeholder="Contexto, sequência do evento, condição encontrada..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-white">2) Causa raiz e/ou modo de falha? *</Label>
                      <Textarea
                        value={incident.causaRaizModoFalha}
                        onChange={(e) => setIncident((prev) => ({ ...prev, causaRaizModoFalha: e.target.value }))}
                        rows={3}
                        placeholder="Modo de falha, causa raiz (5 porquês), fator humano/processo/equipamento..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-white">3) Barreiras/cuidado que poderiam evitar?</Label>
                      <Textarea
                        value={incident.barreirasCuidados}
                        onChange={(e) => setIncident((prev) => ({ ...prev, barreirasCuidados: e.target.value }))}
                        rows={3}
                        placeholder="Procedimentos, checagens, EPIs, bloqueios, configuração, redundância..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-white">4) Ações corretivas e preventivas (CAPA)</Label>
                      <Textarea
                        value={incident.acoesCorretivasPreventivas}
                        onChange={(e) => setIncident((prev) => ({ ...prev, acoesCorretivasPreventivas: e.target.value }))}
                        rows={3}
                        placeholder="O que foi feito para corrigir e para evitar repetição..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-white">5) O que mudou para não repetir?</Label>
                      <Textarea
                        value={incident.mudancasImplementadas}
                        onChange={(e) => setIncident((prev) => ({ ...prev, mudancasImplementadas: e.target.value }))}
                        rows={3}
                        placeholder="Mudança em processo, proteção/automação, treinamento, parametrização, ferramentas..."
                      />
                    </div>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="study-url" className="text-white">URL do material</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="study-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://artigo-ou-video..."
                    className="flex-1"
                  />
                  <Button onClick={handleAddSource} disabled={adding || !url.trim()}>
                    <LinkIcon className="h-4 w-4 mr-2" />
                    {adding ? "Adicionando..." : "Adicionar"}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-white">Ou envie um arquivo (PDF, Word, imagem, TXT, JSON, Excel)</Label>
                <AttachmentUploader
                  onAttachmentsChange={handleFilesUploaded}
                  maxFiles={newCategory === "RELATORIO_OCORRENCIA" ? 1 : 3}
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
                <p className="text-xs text-white/80">
                  Materiais inativos por 30 dias sem consulta saem automaticamente do catálogo.
                </p>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="study-search" className="text-white text-xs">Buscar</Label>
            <Input
              id="study-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, resumo, categoria ou tema..."
              className="text-white placeholder:text-white/50"
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-white/80">Seu catálogo</p>
            {loadingSources && <p className="text-sm text-white/70">Carregando sua base de estudos...</p>}
            {!loadingSources && filteredMySources.length === 0 && (
              <p className="text-sm text-white/70">Nenhum material salvo ainda. Use o botão acima para adicionar.</p>
            )}
            {CATEGORY_ORDER.map((cat) => {
              const items = myByCategory[cat];
              if (!items || !items.length) return null;
              return (
                <div key={cat} className="space-y-1">
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-white/60">
                    {CATEGORY_LABELS[cat]}
                  </p>
                  {items.map((s) => {
                    const isActive = s.id === selectedSourceId;
                    const topicKey = (s.topic || "").toUpperCase().replace(/\s+/g, "_");
                    const topicLabel = topicKey ? (TOPIC_LABELS[topicKey] || s.topic || "") : "";
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        className={`w-full text-left rounded-md border px-3 py-2 transition-colors cursor-pointer ${
                          isActive
                            ? "border-primary/80 bg-primary/20"
                            : "border-white/30 bg-white/5 hover:border-primary/40"
                        }`}
                        onClick={() => handleSelectSource(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectSource(s.id);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold leading-tight text-white">
                              {s.title?.trim() || deriveTitleFromUrl(s.url || "")}
                            </p>
                            <p className="text-[11px] text-white/70">
                              {new Date(s.created_at).toLocaleString(getActiveLocale())}
                            </p>
                            {statusBadge(s)}
                          </div>
                          <div className="flex items-center gap-1">
                            {topicLabel && (
                              <Badge variant="outline" className="text-[10px] border-white/50 text-white/90">
                                {topicLabel}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-[10px] border-white/50 text-white">
                              {s.kind.toUpperCase()}
                            </Badge>
                            {canManageSource(s) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSource(s.id);
                                }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white/70 hover:text-red-400 hover:bg-white/10 transition-colors"
                                aria-label="Remover material de estudo"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-white mt-1 line-clamp-2">
                          {displaySummary(s)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {showOrgCatalog && (
            <div className="space-y-2 pt-2 border-t border-white/20">
              <p className="text-xs font-semibold text-white/80">Catálogo da organização</p>
              {!loadingSources && filteredOrgSources.length === 0 && (
                <p className="text-sm text-white/70">Nenhum material publicado pela organização ainda.</p>
              )}
              {CATEGORY_ORDER.map((cat) => {
                const items = orgByCategory[cat];
                if (!items || !items.length) return null;
                return (
                  <div key={cat} className="space-y-1">
                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-white/60">
                      {CATEGORY_LABELS[cat]}
                    </p>
                    {items.map((s) => {
                      const isActive = s.id === selectedSourceId;
                      const topicKey = (s.topic || "").toUpperCase().replace(/\s+/g, "_");
                      const topicLabel = topicKey ? (TOPIC_LABELS[topicKey] || s.topic || "") : "";
                      const isDraft = s.published === false;
                      return (
                        <div
                          key={s.id}
                          role="button"
                          tabIndex={0}
                          className={`w-full text-left rounded-md border px-3 py-2 transition-colors cursor-pointer ${
                            isActive
                              ? "border-primary/80 bg-primary/20"
                              : "border-white/30 bg-white/5 hover:border-primary/40"
                          }`}
                          onClick={() => handleSelectSource(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectSource(s.id);
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold leading-tight text-white">
                                {s.title?.trim() || deriveTitleFromUrl(s.url || "")}
                              </p>
                              <p className="text-[11px] text-white/70">
                                {new Date(s.created_at).toLocaleString(getActiveLocale())}
                              </p>
                              {statusBadge(s)}
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[10px] border-blue-300/60 text-blue-100 bg-blue-500/10">
                                {isDraft ? "RASCUNHO" : "ORG"}
                              </Badge>
                              {topicLabel && (
                                <Badge variant="outline" className="text-[10px] border-white/50 text-white/90">
                                  {topicLabel}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-[10px] border-white/50 text-white">
                                {s.kind.toUpperCase()}
                              </Badge>
                              {canManageSource(s) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteSource(s.id);
                                  }}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white/70 hover:text-red-400 hover:bg-white/10 transition-colors"
                                  aria-label="Remover material de estudo"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-white mt-1 line-clamp-2">
                            {displaySummary(s)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSource && (
        <Card className="bg-white/5 border border-white/20 text-white shadow-xl backdrop-blur-md">
          <CardHeader className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-lg text-white truncate">{selectedSource.title}</CardTitle>
                <CardDescription className="text-white/80">
                  {normalizeCategory(selectedSource.category) in CATEGORY_LABELS
                    ? CATEGORY_LABELS[normalizeCategory(selectedSource.category)]
                    : "Outros"}
                  {selectedSource.topic ? ` • ${TOPIC_LABELS[(selectedSource.topic || "").toUpperCase().replace(/\\s+/g, "_")] || selectedSource.topic}` : ""}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {canPublishOrg && normalizeScope(selectedSource.scope) === "org" && (
                  <div className="flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2">
                    <p className="text-xs text-white/80">Publicado</p>
                    <Switch
                      checked={selectedSource.published !== false}
                      onCheckedChange={(v) => handleSetPublished(selectedSource.id, v)}
                    />
                  </div>
                )}
                {studioAccess && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-white/40 text-white"
                    onClick={() => {
                      navigate(`/studio?module=quiz&seed_source=${selectedSource.id}`);
                    }}
                  >
                    Criar quiz
                  </Button>
                )}
                {selectedSource.url && (
                  <Button asChild size="sm" variant="outline" className="border-white/40 text-white">
                    <a href={selectedSource.url} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-white">
            {selectedSource.summary && (
              <p className="text-sm text-white/90 whitespace-pre-line">{selectedSource.summary}</p>
            )}

            {(() => {
              const meta = selectedSource.metadata && typeof selectedSource.metadata === "object" ? selectedSource.metadata : null;
              const incident = meta?.incident && typeof meta.incident === "object" ? meta.incident : null;
              const aiIncident = meta?.ai?.incident && typeof meta.ai.incident === "object" ? meta.ai.incident : null;
              const category = normalizeCategory(selectedSource.category);
              if (category !== "RELATORIO_OCORRENCIA" && !incident && !aiIncident) return null;

              const bullets = (arr: any) =>
                Array.isArray(arr) ? arr.map((x) => String(x || "").trim()).filter(Boolean) : [];

              const aprendizados = bullets(aiIncident?.aprendizados);
              const cuidados = bullets(aiIncident?.cuidados);
              const mudancas = bullets(aiIncident?.mudancas);

              return (
                <div className="space-y-4">
                  {incident && (
                    <div className="rounded-md border border-white/20 bg-white/5 p-3 space-y-2">
                      <p className="text-xs font-semibold text-white/80">Relatório de Ocorrência (formulário)</p>
                      {incident.ocorrido && (
                        <p className="text-sm text-white/90 whitespace-pre-line">
                          <span className="text-white/70">Ocorrido: </span>
                          {String(incident.ocorrido)}
                        </p>
                      )}
                      {incident.causa_raiz_modo_falha && (
                        <p className="text-sm text-white/90 whitespace-pre-line">
                          <span className="text-white/70">Causa raiz / modo de falha: </span>
                          {String(incident.causa_raiz_modo_falha)}
                        </p>
                      )}
                      {incident.barreiras_cuidados && (
                        <p className="text-sm text-white/90 whitespace-pre-line">
                          <span className="text-white/70">Barreiras / cuidados: </span>
                          {String(incident.barreiras_cuidados)}
                        </p>
                      )}
                      {incident.acoes_corretivas_preventivas && (
                        <p className="text-sm text-white/90 whitespace-pre-line">
                          <span className="text-white/70">Ações (CAPA): </span>
                          {String(incident.acoes_corretivas_preventivas)}
                        </p>
                      )}
                      {incident.mudancas_implementadas && (
                        <p className="text-sm text-white/90 whitespace-pre-line">
                          <span className="text-white/70">Mudanças implementadas: </span>
                          {String(incident.mudancas_implementadas)}
                        </p>
                      )}
                    </div>
                  )}

                  {(aprendizados.length || cuidados.length || mudancas.length) && (
                    <div className="rounded-md border border-white/20 bg-white/5 p-3 space-y-3">
                      <p className="text-xs font-semibold text-white/80">Insights (IA)</p>
                      {aprendizados.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-white/70">Aprendizados</p>
                          <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                            {aprendizados.map((t, i) => (
                              <li key={`apr-${i}`}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {cuidados.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-white/70">Cuidados / barreiras</p>
                          <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                            {cuidados.map((t, i) => (
                              <li key={`cui-${i}`}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {mudancas.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-white/70">Mudanças</p>
                          <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                            {mudancas.map((t, i) => (
                              <li key={`mud-${i}`}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Chat de Estudos */}
      <Card className="bg-white/5 border border-white/20 text-white shadow-xl backdrop-blur-md">
        <CardHeader className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <BookOpenCheck className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl font-semibold leading-tight text-white">Oráculo (perguntas e respostas)</CardTitle>
              <CardDescription className="text-white/80">
                Pergunte e receba respostas com base nos seus materiais, no catálogo da organização e no Compêndio de Ocorrências.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 text-white">
          <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] gap-4">
            <div className="space-y-3">
              <div className="rounded-lg border border-white/20 bg-white/5 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white">Temas da Base de Conhecimento (GPTs)</p>
                    <p className="text-[11px] text-white/70">
                      Selecione um tema/subtema (até 3 níveis) para focar o Oráculo e puxar trechos do fórum e do StudyLab como contexto.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-white/20 bg-black/20 px-2 py-1">
                    <p className="text-[11px] text-white/70">Usar</p>
                    <Switch checked={kbEnabled} onCheckedChange={setKbEnabled} />
                  </div>
                </div>

                <ForumKbThemeMenu
                  selected={kbSelection}
                  maxTags={20}
                  onSelect={(next) => {
                    setKbSelection(next);
                    if (next) setKbEnabled(true);
                  }}
                />

                {kbSelection?.tags?.length ? (
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-white/30 text-white"
                      onClick={() => setKbSelection(null)}
                    >
                      Limpar foco
                    </Button>
                    <div className="flex flex-wrap justify-end gap-1">
                      {kbSelection.tags.slice(0, 6).map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px] border-white/30 text-white/85">
                          #{t}
                        </Badge>
                      ))}
                      {kbSelection.tags.length > 6 && (
                        <Badge variant="outline" className="text-[10px] border-white/30 text-white/85">
                          +{kbSelection.tags.length - 6}
                        </Badge>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-white/70">
                    Dica: use hashtags consistentes no fórum e no StudyLab (ex.: <span className="text-white/90">#protecao_transformadores_shutdown</span>) para melhorar este menu.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Label className="text-white">Pergunta</Label>
                <div className="flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white">Modo Oráculo</p>
                    <p className="text-[11px] text-white/70">
                      {oracleMode ? "Busca em toda a base" : "Somente no material selecionado"}
                    </p>
                  </div>
                  <Switch checked={oracleMode} onCheckedChange={setOracleMode} />
                </div>
              </div>
              <div className="border border-white/20 rounded-md p-3 max-h-72 overflow-y-auto bg-white/5 text-sm">
                {chatMessages.length === 0 && (
                  <p className="text-white/70 text-xs">
                    {oracleMode
                      ? "Pergunte qualquer coisa sobre os temas da sua área. O Oráculo busca nos materiais e traz um resumo prático (com referências)."
                      : "Selecione um material no catálogo acima e pergunte sobre ele. A IA usa o conteúdo selecionado como contexto."}
                  </p>
                )}
                {chatMessages.map((m, idx) => (
                  <div key={idx} className={`mb-2 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`px-3 py-2 rounded-2xl max-w-[80%] ${
                        m.role === "user" ? "bg-primary text-primary-foreground" : "bg-white/20 text-white"
                      } text-xs whitespace-pre-line`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={
                    oracleMode
                      ? "Ex.: qual modo de falha mais comum em telecom? O que devo checar primeiro?"
                      : selectedSource
                        ? `Pergunte sobre: ${selectedSource.title}`
                        : "Selecione um material para perguntar"
                  }
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSend();
                    }
                  }}
                />
                <Button type="button" onClick={handleChatSend} disabled={chatLoading || !chatInput.trim()}>
                  {chatLoading ? "Pensando..." : "Enviar"}
                </Button>
              </div>
              {chatError && <p className="text-sm text-destructive">Erro: {chatError}</p>}
              <p className="text-[11px] text-white/70">
                {oracleMode
                  ? "O Oráculo busca no catálogo e no compêndio, e também usa o histórico desta conversa."
                  : "A IA prioriza o material selecionado no catálogo e o histórico desta conversa."}
                {kbEnabled && kbSelection?.tags?.length ? " (com foco adicional no tema selecionado na base de conhecimento)" : ""}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
};
