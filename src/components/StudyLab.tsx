import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LibraryBig, MessageCircle, Plus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { apiFetch } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/activeLocale";

import { AttachmentUploader } from "@/components/AttachmentUploader";
import { ForumKbThemeMenu } from "@/components/ForumKbThemeMenu";
import type { ForumKbSelection } from "@/components/ForumKbThemeSelector";
import { TipDialogButton } from "@/components/TipDialogButton";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { DJT_RULES_ARTICLE } from "../../shared/djt-rules";

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
  expires_at?: string | null;
  access_count?: number | null;
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

const PRIVATE_TTL_DAYS = 7;
const FIXED_RULES_ID = "fixed:djt-quest-rules";

const FIXED_SOURCES: StudySource[] = [
  {
    id: FIXED_RULES_ID,
    user_id: "system",
    title: DJT_RULES_ARTICLE.title,
    kind: "text",
    url: null,
    storage_path: null,
    summary: DJT_RULES_ARTICLE.summary,
    ingest_status: "ok",
    ingested_at: null,
    ingest_error: null,
    topic: "OUTROS",
    category: "OUTROS",
    scope: "org",
    published: true,
    metadata: {
      fixed: true,
      fixed_body: DJT_RULES_ARTICLE.body,
      ai: { outline: DJT_RULES_ARTICLE.outline },
      tags: DJT_RULES_ARTICLE.tags,
    },
    is_persistent: true,
    created_at: "2025-01-01T00:00:00Z",
    last_used_at: null,
    expires_at: null,
    access_count: 0,
  },
];

const normalizeCategory = (raw: unknown): StudyCategory => {
  const s = (raw || "").toString().trim().toUpperCase().replace(/\s+/g, "_");
  return (STUDY_CATEGORIES as readonly string[]).includes(s) ? (s as StudyCategory) : "OUTROS";
};

const normalizeScope = (raw: unknown): StudyScope => {
  const s = (raw || "").toString().trim().toLowerCase();
  return s === "org" ? "org" : "user";
};

const normalizeTopic = (raw: unknown) => (raw || "").toString().trim().toUpperCase().replace(/\s+/g, "_");

const createChatSessionId = () => {
  if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
    return (crypto as any).randomUUID();
  }
  return `studychat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

export const StudyLab = () => {
  const { user, studioAccess } = useAuth();
  const navigate = useNavigate();

  const [sources, setSources] = useState<StudySource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [catalogTab, setCatalogTab] = useState<"tree" | "list">("tree");

  const [search, setSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | "public" | "private">("all");
  const [categoryFilter, setCategoryFilter] = useState<StudyCategory | "ALL">("ALL");
  const [topicFilter, setTopicFilter] = useState<string>("ALL");

  const [newCategory, setNewCategory] = useState<StudyCategory>("OUTROS");
  const [newVisibility, setNewVisibility] = useState<"public" | "private">("public");
  const [incident, setIncident] = useState<IncidentForm>(EMPTY_INCIDENT);
  const [url, setUrl] = useState("");

  const purgeDoneRef = useRef(false);
  const insertedUrlsRef = useRef<Set<string>>(new Set());

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatAttachments, setChatAttachments] = useState<string[]>([]);
  const [chatUploading, setChatUploading] = useState(false);
  const [chatUploadKey, setChatUploadKey] = useState(0);
  const [chatSessionId, setChatSessionId] = useState<string>(() => createChatSessionId());
  const [chatAttachmentsOpen, setChatAttachmentsOpen] = useState(false);

  const [oracleMode, setOracleMode] = useState(true);
  const [useWeb, setUseWeb] = useState(false);
  const [kbEnabled, setKbEnabled] = useState(false);
  const [kbSelection, setKbSelection] = useState<ForumKbSelection | null>(null);

  useEffect(() => {
    if (uploadOpen) insertedUrlsRef.current.clear();
  }, [uploadOpen]);

  const isFixedSource = (s: StudySource) => s.id === FIXED_RULES_ID;
  const isPublicSource = (s: StudySource) => normalizeScope(s.scope) === "org" && s.published !== false;
  const isPrivateSource = (s: StudySource) => normalizeScope(s.scope) === "user" || s.published === false;

  const displaySummary = (s: StudySource) => s.summary?.trim() || s.url || "Sem resumo";

  const renderOutline = (nodes: any[], depth = 0): JSX.Element | null => {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;
    return (
      <ul className={`space-y-1 ${depth > 0 ? "ml-4" : ""}`}>
        {nodes.map((node, idx) => {
          const title = String(node?.title || "").trim();
          if (!title) return null;
          return (
            <li key={`${depth}-${idx}`} className="text-xs text-muted-foreground">
              <span className="text-foreground/90">{title}</span>
              {renderOutline(node?.children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  const statusBadge = (s: StudySource) => {
    if (s.ingest_status === "ok") return null;
    if (s.ingest_status === "pending") {
      return (
        <Badge variant="outline" className="text-[10px]">
          analisando…
        </Badge>
      );
    }
    if (s.ingest_status === "failed") {
      return (
        <Badge variant="outline" className="text-[10px] border-red-400 text-red-500">
          falhou
        </Badge>
      );
    }
    return null;
  };

  const validateBeforeInsert = (category: StudyCategory) => {
    if (category !== "RELATORIO_OCORRENCIA") return null;
    if (!incident.ocorrido.trim()) return "Relatório de ocorrência: descreva o que aconteceu.";
    if (!incident.causaRaizModoFalha.trim()) return "Relatório de ocorrência: informe causa raiz e/ou modo de falha.";
    return null;
  };

  const buildInsertMetadata = (category: StudyCategory) => {
    if (category !== "RELATORIO_OCORRENCIA") return {};
    const payload = {
      ocorrido: incident.ocorrido?.trim() || null,
      causa_raiz_modo_falha: incident.causaRaizModoFalha?.trim() || null,
      barreiras_cuidados: incident.barreirasCuidados?.trim() || null,
      acoes_corretivas_preventivas: incident.acoesCorretivasPreventivas?.trim() || null,
      mudancas_implementadas: incident.mudancasImplementadas?.trim() || null,
    };
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === "string" && v.trim()) cleaned[k] = v.trim();
    }
    return cleaned && Object.keys(cleaned).length ? { incident: cleaned } : { incident: {} };
  };

  const deriveTitleFromUrl = (link: string) => {
    try {
      const parsed = new URL(link);
      const host = parsed.hostname.replace(/^www\./, "");
      const lastSegment = parsed.pathname.split("/").filter(Boolean).pop() || "";
      if (!lastSegment) return host;
      const cleaned = lastSegment
        .replace(/\.[^.]+$/, "")
        .replace(/[_\-]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!cleaned) return host;
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
        title = s.kind === "file" ? deriveTitleFromFile(s.url || s.storage_path || "Documento") : deriveTitleFromUrl(s.url || "");
      }

      if (!summary?.trim()) {
        summary = s.kind === "file" ? deriveSummaryFromFile(s.url || s.storage_path || "") : deriveSummaryFromUrl(s.url || "");
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
        // best-effort
      }
    }

    return normalized;
  };

  const fetchSources = async () => {
    if (!user) return;
    try {
      setLoadingSources(true);
      if (!purgeDoneRef.current) {
        purgeDoneRef.current = true;
        try {
          await apiFetch("/api/study?handler=purge-expired", { method: "POST" });
        } catch {
          // best-effort
        }
      }

      const columnsV2 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, category, scope, published, metadata, is_persistent, expires_at, access_count, created_at, last_used_at";
      const columnsV1 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at";

      let data: any[] | null = null;
      let error: any = null;

      const v2 = await supabase.from("study_sources").select(columnsV2).order("created_at", { ascending: false });
      data = v2.data as any[] | null;
      error = v2.error;

      if (error && /column .*?(category|scope|published|metadata|expires_at|access_count)/i.test(String(error.message || error))) {
        const v1 = await supabase.from("study_sources").select(columnsV1).order("created_at", { ascending: false });
        data = v1.data as any[] | null;
        error = v1.error;
      }

      if (error) throw error;
      const normalized = await normalizeSources((data || []) as StudySource[]);
      setSources(normalized);
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

  const allSources = useMemo(() => [...FIXED_SOURCES, ...sources], [sources]);
  const selectedSource = useMemo(
    () => allSources.find((s) => s.id === selectedSourceId) || null,
    [allSources, selectedSourceId],
  );

  const matchesSearch = (s: StudySource, q: string) => {
    const meta = s.metadata && typeof s.metadata === "object" ? s.metadata : null;
    const tags = Array.isArray(meta?.tags) ? meta.tags : Array.isArray(meta?.ai?.tags) ? meta.ai.tags : [];
    const hay = [
      s.title || "",
      s.summary || "",
      s.url || "",
      normalizeCategory(s.category),
      s.topic || "",
      TOPIC_LABELS[normalizeTopic(s.topic)] || "",
      tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };

  const visibleSources = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    return allSources.filter((s) => {
      if (!isFixedSource(s) && s.expires_at) {
        const exp = Date.parse(String(s.expires_at));
        if (Number.isFinite(exp) && exp <= now) return false;
      }
      if (visibilityFilter === "public" && !isFixedSource(s) && !isPublicSource(s)) return false;
      if (visibilityFilter === "private") {
        if (!user) return false;
        if (!isPrivateSource(s) || s.user_id !== user.id) return false;
      }
      if (categoryFilter !== "ALL" && normalizeCategory(s.category) !== categoryFilter) return false;
      if (topicFilter !== "ALL" && normalizeTopic(s.topic) !== topicFilter) return false;
      if (q && !matchesSearch(s, q)) return false;
      return true;
    });
  }, [allSources, categoryFilter, isPrivateSource, isPublicSource, search, topicFilter, user, visibilityFilter]);

  const topicsByCategory = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const s of allSources) {
      if (!s || isFixedSource(s)) continue;
      const cat = normalizeCategory(s.category);
      const topic = normalizeTopic(s.topic || "OUTROS") || "OUTROS";
      if (!out[cat]) out[cat] = {};
      out[cat][topic] = (out[cat][topic] || 0) + 1;
    }
    return out;
  }, [allSources]);

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
    for (const u of freshUrls) insertedUrlsRef.current.add(u);

    setAdding(true);
    try {
      const effectiveScope: StudyScope = newVisibility === "public" ? "org" : "user";
      const effectivePublished = effectiveScope === "org";
      const effectiveExpiresAt =
        effectiveScope === "user" ? new Date(Date.now() + PRIVATE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString() : null;

      const metadata = buildInsertMetadata(category);
      const inserts = freshUrls.map((u) => {
        const title = deriveTitleFromFile(u);
        const summary = deriveSummaryFromFile(u);
        return {
          user_id: user.id,
          title,
          kind: "file",
          url: u,
          summary,
          ingest_status: "pending",
          is_persistent: effectiveScope === "org",
          last_used_at: new Date().toISOString(),
          category,
          scope: effectiveScope,
          published: effectivePublished,
          expires_at: effectiveExpiresAt,
          metadata,
        };
      });

      const selectV2 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, category, scope, published, metadata, is_persistent, expires_at, access_count, created_at, last_used_at";
      const selectV1 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at";

      let data: any[] | null = null;
      let error: any = null;

      const v2 = await supabase.from("study_sources").insert(inserts as any).select(selectV2);
      data = v2.data as any[] | null;
      error = v2.error;

      if (error && /column .*?(category|scope|published|metadata|expires_at|access_count)/i.test(String(error.message || error))) {
        const legacyInserts = inserts.map(({ category: _c, scope: _s, published: _p, metadata: _m, expires_at: _e, ...rest }) => rest);
        const v1 = await supabase.from("study_sources").insert(legacyInserts as any).select(selectV1);
        data = v1.data as any[] | null;
        error = v1.error;
      }

      if (error) throw error;
      if (data && Array.isArray(data)) {
        const list = data as StudySource[];
        setSources((prev) => [...list, ...prev]);
        setSelectedSourceId(list[0]?.id || selectedSourceId);

        setIngesting(true);
        try {
          await Promise.all(
            list.map((s) =>
              apiFetch("/api/ai?handler=study-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "ingest", source_id: s.id }),
              }).catch(() => undefined),
            ),
          );
          await fetchSources();
        } finally {
          setIngesting(false);
        }

        toast.success("Documentos adicionados. A IA está catalogando.");
        setUploadOpen(false);
      }
    } catch (e: any) {
      for (const u of freshUrls) insertedUrlsRef.current.delete(u);
      toast.error(e?.message || "Não foi possível adicionar o documento.");
    } finally {
      setAdding(false);
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
      const effectiveScope: StudyScope = newVisibility === "public" ? "org" : "user";
      const effectivePublished = effectiveScope === "org";
      const effectiveExpiresAt =
        effectiveScope === "user" ? new Date(Date.now() + PRIVATE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString() : null;
      const metadata = buildInsertMetadata(category);

      const payload = {
        user_id: user.id,
        title: deriveTitleFromUrl(link),
        kind: "url",
        url: link,
        summary: deriveSummaryFromUrl(link),
        ingest_status: "pending",
        is_persistent: effectiveScope === "org",
        last_used_at: new Date().toISOString(),
        category,
        scope: effectiveScope,
        published: effectivePublished,
        expires_at: effectiveExpiresAt,
        metadata,
      };

      const selectV2 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, category, scope, published, metadata, is_persistent, expires_at, access_count, created_at, last_used_at";
      const selectV1 =
        "id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at";

      let data: any = null;
      let error: any = null;

      const v2 = await supabase.from("study_sources").insert(payload as any).select(selectV2).maybeSingle();
      data = v2.data as any;
      error = v2.error;

      if (error && /column .*?(category|scope|published|metadata|expires_at|access_count)/i.test(String(error.message || error))) {
        const { category: _c, scope: _s, published: _p, metadata: _m, expires_at: _e, ...legacyPayload } = payload as any;
        const v1 = await supabase.from("study_sources").insert(legacyPayload).select(selectV1).maybeSingle();
        data = v1.data as any;
        error = v1.error;
      }

      if (error) throw error;
      if (data) {
        const created = data as StudySource;
        setSources((prev) => [created, ...prev]);
        setSelectedSourceId(created.id);

        setIngesting(true);
        try {
          await apiFetch("/api/ai?handler=study-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "ingest", source_id: created.id }),
          }).catch(() => undefined);
          await fetchSources();
        } finally {
          setIngesting(false);
        }

        toast.success("Material adicionado. A IA está catalogando.");
      }
      setUrl("");
      setUploadOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível adicionar o material.");
    } finally {
      setAdding(false);
    }
  };

  const resetChatAttachments = () => {
    setChatAttachments([]);
    setChatUploadKey((prev) => prev + 1);
  };

  const handleNewChat = () => {
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setChatSessionId(createChatSessionId());
    resetChatAttachments();
  };

  const handleChatSend = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed && chatAttachments.length === 0) return;
    if (!user) {
      toast("Faça login para usar o chat de estudos.");
      return;
    }
    if (!trimmed) {
      toast.error("Digite uma pergunta para acompanhar o anexo.");
      return;
    }
    if (chatUploading) {
      toast("Aguarde o upload dos anexos antes de enviar.");
      return;
    }

    if (!oracleMode) {
      if (!selectedSourceId) {
        toast.error("Selecione um material no catálogo para conversar sobre ele.");
        setCatalogOpen(true);
        return;
      }
      if (selectedSourceId === FIXED_RULES_ID) {
        toast.error("Use o Catálogo para perguntar sobre o artigo fixo.");
        return;
      }
      const sel = sources.find((s) => s.id === selectedSourceId);
      if (sel && sel.ingest_status === "failed") {
        toast.error("Curadoria do material falhou. Tente catalogar novamente no Catálogo.");
        return;
      }
    }

    const nextMessages = [...chatMessages, { role: "user", content: trimmed } as ChatMessage];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    try {
      const resp = await apiFetch("/api/ai?handler=study-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: oracleMode ? "oracle" : "study",
          ...(oracleMode ? {} : { source_id: selectedSourceId }),
          session_id: chatSessionId,
          attachments: chatAttachments.map((url) => ({ url })),
          language: getActiveLocale(),
          ...(oracleMode ? { use_web: useWeb } : {}),
          ...(kbEnabled && kbSelection?.tags?.length ? { kb_tags: kbSelection.tags, kb_focus: kbSelection.label } : {}),
          messages: nextMessages,
        }),
      });
      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok || json?.success === false) {
        setChatError(json?.error || "Falha no chat de estudos");
        return;
      }
      const answer = json.answer || json.content || "";
      if (!answer) {
        setChatError("A IA retornou uma resposta vazia.");
        return;
      }
      if (typeof json?.session_id === "string" && json.session_id.trim()) {
        setChatSessionId(json.session_id.trim());
      }
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      resetChatAttachments();
    } catch (e: any) {
      toast(`Erro no chat de estudos: ${e?.message || e}`);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">StudyLab</h1>
            <TipDialogButton tipId="studylab-oracle" ariaLabel="Entenda o StudyLab" />
          </div>
          <p className="text-sm text-muted-foreground">
            Um chat para perguntar + um lugar simples para subir materiais. O catálogo fica no botão “Catálogo”.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setCatalogOpen(true)}>
            <LibraryBig className="mr-2 h-4 w-4" />
            Catálogo
          </Button>
          <Button type="button" onClick={() => setUploadOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </div>

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

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4" />
                Chat
              </CardTitle>
              <CardDescription>
                {oracleMode
                  ? "Catálogo: busca na sua base + catálogo público."
                  : selectedSource
                    ? `Material: ${selectedSource.title}`
                    : "Selecione um material no catálogo."}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={oracleMode ? "oracle" : "source"}
                onValueChange={(v) => {
                  if (v === "oracle") {
                    setOracleMode(true);
                  } else {
                    setOracleMode(false);
                    if (!selectedSourceId || selectedSourceId === FIXED_RULES_ID) setCatalogOpen(true);
                  }
                }}
              >
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oracle">Catálogo (toda a base)</SelectItem>
                  <SelectItem value="source">Material específico</SelectItem>
                </SelectContent>
              </Select>
              {!oracleMode && (
                <Button type="button" variant="outline" size="sm" onClick={() => setCatalogOpen(true)}>
                  Escolher material
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={handleNewChat}>
                Nova conversa
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Pesquisa online</p>
                <p className="text-xs text-muted-foreground">Usa web + base (apenas no Catálogo).</p>
              </div>
              <Switch checked={useWeb} onCheckedChange={setUseWeb} disabled={!oracleMode} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Foco por hashtags</p>
                <p className="text-xs text-muted-foreground">Ajuda o Catálogo a priorizar temas.</p>
              </div>
              <Switch checked={kbEnabled} onCheckedChange={setKbEnabled} />
            </div>
            {kbEnabled && (
              <div className="sm:col-span-2 rounded-md border p-3">
                <ForumKbThemeMenu selection={kbSelection} onSelect={setKbSelection} />
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="h-[360px] overflow-y-auto rounded-md border bg-muted/30 p-3">
            {chatMessages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {oracleMode
                  ? "Pergunte qualquer coisa. O Catálogo responde usando sua base (e web se ativado)."
                  : "Escolha um material no catálogo e pergunte sobre ele."}
              </p>
            )}
            {chatMessages.map((m, idx) => (
              <div key={idx} className={`mb-2 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={[
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-background border",
                  ].join(" ")}
                >
                  {m.content}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Dialog open={chatAttachmentsOpen} onOpenChange={setChatAttachmentsOpen}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="relative shrink-0"
                  aria-label="Anexar arquivos"
                  title="Anexar arquivos"
                  disabled={chatLoading}
                >
                  <Plus className="h-4 w-4" />
                  {chatUploading && (
                    <span
                      className="absolute -bottom-1 -right-1 inline-flex h-3 w-3 rounded-full bg-amber-400"
                      aria-label="Enviando anexos"
                      title="Enviando…"
                    />
                  )}
                  {chatAttachments.length > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-5 min-w-[20px] justify-center px-1 text-[10px]">
                      {chatAttachments.length}
                    </Badge>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Anexos</DialogTitle>
                  <DialogDescription>
                    Imagens, desenhos, PDFs e documentos ajudam o Catálogo a aprofundar a resposta e ficam registrados no compêndio.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <AttachmentUploader
                    key={chatUploadKey}
                    onAttachmentsChange={setChatAttachments}
                    onUploadingChange={setChatUploading}
                    maxFiles={4}
                    maxSizeMB={20}
                    bucket="evidence"
                    pathPrefix="study-chat"
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
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {chatAttachments.length ? `${chatAttachments.length} anexo(s) selecionado(s).` : "Nenhum anexo selecionado."}
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={resetChatAttachments} disabled={!chatAttachments.length && !chatUploading}>
                      Limpar
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                oracleMode
                  ? "Digite sua pergunta…"
                  : selectedSource
                    ? `Pergunte sobre: ${selectedSource.title}`
                    : "Selecione um material para perguntar"
              }
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSend();
                }
              }}
            />
            <Button
              type="button"
              onClick={handleChatSend}
              disabled={chatLoading || chatUploading || (!chatInput.trim() && chatAttachments.length === 0)}
            >
              {chatLoading ? "Pensando..." : "Enviar"}
            </Button>
          </div>
          {chatError && <p className="text-sm text-destructive">Erro: {chatError}</p>}
        </CardContent>
      </Card>

      <Sheet open={catalogOpen} onOpenChange={setCatalogOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Catálogo</SheetTitle>
            <SheetDescription>Pesquise por árvore (categoria/tema) ou lista. Clique para usar no chat.</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por título, resumo, tags, tema…" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Visibilidade</Label>
                <Select value={visibilityFilter} onValueChange={(v) => setVisibilityFilter(v as any)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="public">Públicos</SelectItem>
                    <SelectItem value="private">Privados (meus)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas</SelectItem>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tema</Label>
                <Select value={topicFilter} onValueChange={(v) => setTopicFilter(v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos</SelectItem>
                    {Object.keys(TOPIC_LABELS).map((k) => (
                      <SelectItem key={k} value={k}>
                        {TOPIC_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Tabs value={catalogTab} onValueChange={(v) => setCatalogTab(v as any)}>
              <TabsList className="w-full">
                <TabsTrigger value="tree" className="flex-1">
                  Árvore
                </TabsTrigger>
                <TabsTrigger value="list" className="flex-1">
                  Lista ({visibleSources.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tree">
                <div className="space-y-3">
                  {CATEGORY_ORDER.map((cat) => {
                    const topics = topicsByCategory[cat] || {};
                    const topicEntries = Object.entries(topics).sort((a, b) => b[1] - a[1]);
                    const total = Object.values(topics).reduce((acc, n) => acc + n, 0);
                    if (!total) return null;
                    return (
                      <div key={cat} className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{CATEGORY_LABELS[cat]}</p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setCategoryFilter(cat);
                              setTopicFilter("ALL");
                              setCatalogTab("list");
                            }}
                          >
                            Ver ({total})
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {topicEntries.map(([topicKey, count]) => (
                            <Button
                              key={`${cat}:${topicKey}`}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => {
                                setCategoryFilter(cat);
                                setTopicFilter(topicKey);
                                setCatalogTab("list");
                              }}
                            >
                              {TOPIC_LABELS[topicKey] || topicKey}{" "}
                              <span className="ml-1 text-muted-foreground">({count})</span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="list">
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {loadingSources && <p className="text-sm text-muted-foreground">Carregando catálogo…</p>}
                  {!loadingSources && visibleSources.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nenhum material encontrado com esses filtros.</p>
                  )}
                  {visibleSources.map((s) => {
                    const active = s.id === selectedSourceId;
                    const isPublic = isPublicSource(s) || isFixedSource(s);
                    const visibilityLabel = isFixedSource(s) ? "FIXO" : isPublic ? "PÚBLICO" : "PRIVADO";
                    const topicKey = normalizeTopic(s.topic);
                    const topicLabel = topicKey ? TOPIC_LABELS[topicKey] || topicKey : "";
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={[
                          "w-full rounded-md border p-3 text-left transition-colors",
                          active ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                        ].join(" ")}
                        onClick={() => {
                          setSelectedSourceId(s.id);
                          setCatalogOpen(false);
                          if (s.id !== FIXED_RULES_ID) setOracleMode(false);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{s.title?.trim() || "Sem título"}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{displaySummary(s)}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {visibilityLabel}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {CATEGORY_LABELS[normalizeCategory(s.category)] || "Outros"}
                              </Badge>
                              {topicLabel && (
                                <Badge variant="outline" className="text-[10px]">
                                  {topicLabel}
                                </Badge>
                              )}
                              {statusBadge(s)}
                            </div>
                          </div>
                          {s.url && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(s.url!, "_blank", "noreferrer");
                              }}
                            >
                              Abrir
                            </Button>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>

            {selectedSource && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Índice</p>
                  {studioAccess && selectedSource.id !== FIXED_RULES_ID && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/studio?module=quiz&seed_source=${selectedSource.id}`)}
                    >
                      Criar quiz
                    </Button>
                  )}
                </div>
                {selectedSource.summary && (
                  <p className="text-xs text-muted-foreground whitespace-pre-line">{selectedSource.summary}</p>
                )}
                {(() => {
                  const meta = selectedSource.metadata && typeof selectedSource.metadata === "object" ? selectedSource.metadata : null;
                  const outline = meta?.ai?.outline || meta?.outline || [];
                  if (!Array.isArray(outline) || outline.length === 0) return null;
                  return <div className="mt-2">{renderOutline(outline)}</div>;
                })()}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={uploadOpen} onOpenChange={setUploadOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Adicionar material</SheetTitle>
            <SheetDescription>Envie um arquivo ou URL. A IA cria título, resumo e índice.</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Catalogar como</Label>
                <Select value={newCategory} onValueChange={(v) => setNewCategory(normalizeCategory(v))}>
                  <SelectTrigger>
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
              <div className="space-y-2">
                <Label>Visibilidade</Label>
                <Select value={newVisibility} onValueChange={(v) => setNewVisibility(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Público (para todos)</SelectItem>
                    <SelectItem value="private">Privado (expira em {PRIVATE_TTL_DAYS} dias)</SelectItem>
                  </SelectContent>
                </Select>
                {newVisibility === "private" && (
                  <p className="text-xs text-muted-foreground">
                    Materiais privados expiram automaticamente após {PRIVATE_TTL_DAYS} dias.
                  </p>
                )}
              </div>
            </div>

            {newCategory === "RELATORIO_OCORRENCIA" && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">Relatório de ocorrência</p>
                <p className="text-xs text-muted-foreground">Preencha o mínimo e envie o material/URL para a IA catalogar.</p>
                <div className="grid gap-3">
                  <div className="space-y-1">
                    <Label>1) O que aconteceu? *</Label>
                    <Textarea value={incident.ocorrido} onChange={(e) => setIncident((p) => ({ ...p, ocorrido: e.target.value }))} rows={3} />
                  </div>
                  <div className="space-y-1">
                    <Label>2) Causa raiz e/ou modo de falha? *</Label>
                    <Textarea
                      value={incident.causaRaizModoFalha}
                      onChange={(e) => setIncident((p) => ({ ...p, causaRaizModoFalha: e.target.value }))}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>3) Barreiras/cuidado que poderiam evitar?</Label>
                    <Textarea
                      value={incident.barreirasCuidados}
                      onChange={(e) => setIncident((p) => ({ ...p, barreirasCuidados: e.target.value }))}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>4) Ações corretivas e preventivas (CAPA)</Label>
                    <Textarea
                      value={incident.acoesCorretivasPreventivas}
                      onChange={(e) => setIncident((p) => ({ ...p, acoesCorretivasPreventivas: e.target.value }))}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>5) O que mudou para não repetir?</Label>
                    <Textarea
                      value={incident.mudancasImplementadas}
                      onChange={(e) => setIncident((p) => ({ ...p, mudancasImplementadas: e.target.value }))}
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="study-url">URL do material</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="study-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://artigo-ou-video..." className="flex-1" />
                <Button type="button" onClick={handleAddSource} disabled={adding || !url.trim()}>
                  {adding ? "Adicionando..." : "Adicionar"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ou envie um arquivo</Label>
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
              <p className="text-xs text-muted-foreground">Após enviar, a IA gera título/resumo/índice e você encontra no Catálogo.</p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};
