import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, LibraryBig, MessageCircle, Plus, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";

import { apiFetch } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/activeLocale";

import { AttachmentUploader } from "@/components/AttachmentUploader";
import { ForumKbThemeMenu } from "@/components/ForumKbThemeMenu";
import type { ForumKbSelection } from "@/components/ForumKbThemeSelector";
import { TipDialogButton } from "@/components/TipDialogButton";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";

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

type ChatMessage = { role: "user" | "assistant"; content: string; attachments?: string[] };

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

const getSourceMeta = (s: StudySource) =>
  s && s.metadata && typeof s.metadata === "object" ? s.metadata : null;

const getSourceTopicKey = (s: StudySource) => {
  const meta = getSourceMeta(s);
  const raw = s.topic || meta?.ai?.topic || meta?.topic || "OUTROS";
  return normalizeTopic(raw || "OUTROS") || "OUTROS";
};

const getSourceCategoryKey = (s: StudySource) => {
  const meta = getSourceMeta(s);
  const raw = s.category || meta?.ai?.category || meta?.category || "OUTROS";
  return normalizeCategory(raw || "OUTROS");
};

const isChatCompendiumSource = (s: StudySource) => {
  const meta = getSourceMeta(s);
  return String(meta?.source || "").toLowerCase() === "study_chat";
};

const createChatSessionId = () => {
  if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
    return (crypto as any).randomUUID();
  }
  return `studychat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const isImageUrl = (url: string) => /\.(png|jpe?g|webp|gif|bmp|tif|tiff|heic|heif|avif)(\?|#|$)/i.test(url || "");

const getAttachmentLabel = (url: string) => {
  if (!url) return "Anexo";
  try {
    const clean = url.split("?")[0].split("#")[0];
    const name = decodeURIComponent(clean.split("/").pop() || "Anexo");
    return name || "Anexo";
  } catch {
    const name = url.split("/").pop();
    return name || "Anexo";
  }
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
  const { user, studioAccess, roles } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [sources, setSources] = useState<StudySource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogRefreshProgress, setCatalogRefreshProgress] = useState<{ total: number; done: number; failed: number } | null>(null);
  const [cacheCleaning, setCacheCleaning] = useState(false);
  const [reingestingSourceId, setReingestingSourceId] = useState<string | null>(null);

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [catalogTab, setCatalogTab] = useState<"tree" | "list">("tree");
  const [catalogPreviewId, setCatalogPreviewId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | "public" | "private">("all");
  const [categoryFilter, setCategoryFilter] = useState<StudyCategory | "ALL">("ALL");
  const [topicFilter, setTopicFilter] = useState<string>("ALL");
  const catalogSearchRef = useRef<HTMLInputElement | null>(null);

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
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  const [oracleMode, setOracleMode] = useState(false);
  const [useWeb, setUseWeb] = useState(false);
  const [chatQuality, setChatQuality] = useState<"auto" | "instant" | "thinking">("instant");
  const [kbEnabled, setKbEnabled] = useState(false);
  const [kbSelection, setKbSelection] = useState<ForumKbSelection | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const [chatInputFocused, setChatInputFocused] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia?.("(max-width: 768px)")?.matches ?? false;
    window.dispatchEvent(new CustomEvent("djt-nav-visibility", { detail: { hidden: Boolean(isMobile && chatInputFocused) } }));
    return () => {
      window.dispatchEvent(new CustomEvent("djt-nav-visibility", { detail: { hidden: false } }));
    };
  }, [chatInputFocused]);

  const isStaff = useMemo(() => {
    const set = new Set((roles || []).map((r) => String(r || "").toLowerCase()));
    return (
      set.has("admin") ||
      set.has("gerente_djt") ||
      set.has("gerente_divisao_djtx") ||
      set.has("coordenador_djtx")
    );
  }, [roles]);

  useEffect(() => {
    if (uploadOpen) insertedUrlsRef.current.clear();
  }, [uploadOpen]);

  useEffect(() => {
    if (!catalogOpen) return;
    setCatalogTab("list");
    setCatalogPreviewId(null);
    setSearch("");
    setVisibilityFilter("all");
    setCategoryFilter("ALL");
    setTopicFilter("ALL");
    setTimeout(() => catalogSearchRef.current?.focus(), 0);
  }, [catalogOpen]);

  useEffect(() => {
    const el = chatViewportRef.current;
    if (!el) return;
    let raf = 0;
    raf = window.requestAnimationFrame(() => {
      try {
        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        const distanceFromBottom = maxScrollTop - el.scrollTop;
        // Only auto-scroll if the user is already near the bottom (keeps UX stable on mobile).
        if (distanceFromBottom < 64) {
          el.scrollTop = el.scrollHeight;
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [chatMessages.length, chatLoading]);

  const resizeChatTextarea = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = chatInputRef.current;
    if (!el) return;

    const vv = window.visualViewport;
    const viewportH = Math.max(0, Math.round(vv?.height || window.innerHeight || 0));
    const isMobile = window.matchMedia?.("(max-width: 768px)")?.matches ?? false;
    const maxH = Math.max(140, Math.min(360, Math.round(viewportH * (isMobile ? 0.42 : 0.32))));

    try {
      el.style.height = "auto";
      const next = Math.min(el.scrollHeight || 0, maxH);
      el.style.height = `${next}px`;
      el.style.overflowY = (el.scrollHeight || 0) > maxH ? "auto" : "hidden";
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    raf = window.requestAnimationFrame(() => resizeChatTextarea());
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [chatInput, chatInputFocused, resizeChatTextarea]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const onResize = () => resizeChatTextarea();
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, [resizeChatTextarea]);

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
      const filtered = normalized.filter((s) => !isChatCompendiumSource(s));
      setSources(filtered);
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
  const catalogPreviewSource = useMemo(
    () => (catalogPreviewId ? allSources.find((s) => s.id === catalogPreviewId) || null : null),
    [allSources, catalogPreviewId],
  );

  const matchesSearch = (s: StudySource, q: string) => {
    const meta = s.metadata && typeof s.metadata === "object" ? s.metadata : null;
    const tags = Array.isArray(meta?.tags) ? meta.tags : Array.isArray(meta?.ai?.tags) ? meta.ai.tags : [];
    const topicKey = getSourceTopicKey(s);
    const categoryKey = getSourceCategoryKey(s);
    const hay = [
      s.title || "",
      s.summary || "",
      s.url || "",
      categoryKey,
      topicKey,
      TOPIC_LABELS[topicKey] || "",
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
      if (categoryFilter !== "ALL" && getSourceCategoryKey(s) !== categoryFilter) return false;
      if (topicFilter !== "ALL" && getSourceTopicKey(s) !== topicFilter) return false;
      if (q && !matchesSearch(s, q)) return false;
      return true;
    });
  }, [allSources, categoryFilter, isPrivateSource, isPublicSource, search, topicFilter, user, visibilityFilter]);

  const hasActiveCatalogFilters =
    Boolean(search.trim()) || visibilityFilter !== "all" || categoryFilter !== "ALL" || topicFilter !== "ALL";

  const clearCatalogFilters = () => {
    setSearch("");
    setVisibilityFilter("all");
    setCategoryFilter("ALL");
    setTopicFilter("ALL");
  };

  const previewIndex = useMemo(() => {
    if (!catalogPreviewId) return -1;
    return visibleSources.findIndex((s) => s.id === catalogPreviewId);
  }, [catalogPreviewId, visibleSources]);
  const previewPrevId = previewIndex > 0 ? visibleSources[previewIndex - 1]?.id || null : null;
  const previewNextId =
    previewIndex >= 0 && previewIndex < visibleSources.length - 1 ? visibleSources[previewIndex + 1]?.id || null : null;

  const useSourceInChat = (source: StudySource) => {
    if (!source) return;
    if (source.id === FIXED_RULES_ID) {
      setOracleMode(true);
      setCatalogOpen(false);
      return;
    }
    if (source.ingest_status === "failed") {
      toast.error("Curadoria do material falhou. Reprocesse antes de usar no chat.");
      return;
    }
    if (source.ingest_status === "pending") {
      toast("Ainda analisando este material. Tente novamente em alguns instantes.");
      return;
    }
    setSelectedSourceId(source.id);
    setOracleMode(false);
    setCatalogOpen(false);
  };

  const topicsByCategory = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const s of allSources) {
      if (!s || isFixedSource(s)) continue;
      const cat = getSourceCategoryKey(s);
      const topic = getSourceTopicKey(s);
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

  const handleRecatalog = async () => {
    if (!user) {
      toast("Faça login para atualizar o catálogo.");
      return;
    }
    if (catalogRefreshing) return;
    const list = (sources || []).filter((s) => !isFixedSource(s) && !isChatCompendiumSource(s));
    if (!list.length) {
      toast("Nenhum material para catalogar.");
      return;
    }

    setCatalogRefreshing(true);
    setCatalogRefreshProgress({ total: list.length, done: 0, failed: 0 });
    let done = 0;
    let failed = 0;

    for (const s of list) {
      try {
        const resp = await apiFetch("/api/ai?handler=study-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "ingest", source_id: s.id, recatalog: true }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || json?.success === false) {
          failed += 1;
        }
      } catch {
        failed += 1;
      } finally {
        done += 1;
        setCatalogRefreshProgress({ total: list.length, done, failed });
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    }

    await fetchSources();
    setCatalogRefreshing(false);
    const okCount = list.length - failed;
    toast.success(`Catálogo atualizado com IA: ${okCount} ok, ${failed} com falha.`);
  };

  const resetChatAttachments = () => {
    setChatAttachments([]);
    setChatUploadKey((prev) => prev + 1);
  };

  const handleNewChat = () => {
    try {
      chatAbortRef.current?.abort();
    } catch {
      // ignore
    }
    chatAbortRef.current = null;
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setChatSessionId(createChatSessionId());
    resetChatAttachments();
  };

  const stopGenerating = () => {
    try {
      chatAbortRef.current?.abort();
    } catch {
      // ignore
    }
    chatAbortRef.current = null;
    setChatLoading(false);
    setChatError("Geração interrompida.");
  };

  const reingestSource = async (sourceId: string) => {
    if (!user) {
      toast("Faça login para catalogar novamente.");
      return;
    }
    setReingestingSourceId(sourceId);
    try {
      await apiFetch("/api/ai?handler=study-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ingest", source_id: sourceId, recatalog: true }),
      });
      await fetchSources();
      toast.success("Material reprocessado com IA.");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível reprocessar o material.");
    } finally {
      setReingestingSourceId(null);
    }
  };

  const handleReingestFailed = async () => {
    if (!user) {
      toast("Faça login para atualizar o catálogo.");
      return;
    }
    if (catalogRefreshing || ingesting || loadingSources) return;
    const failedList = (sources || []).filter(
      (s) => !isFixedSource(s) && !isChatCompendiumSource(s) && s.ingest_status === "failed",
    );
    if (!failedList.length) {
      toast("Nenhum material com falha para reprocessar.");
      return;
    }
    setCatalogRefreshing(true);
    setCatalogRefreshProgress({ total: failedList.length, done: 0, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const s of failedList) {
      try {
        const resp = await apiFetch("/api/ai?handler=study-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "ingest", source_id: s.id, recatalog: true }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || json?.success === false) failed += 1;
      } catch {
        failed += 1;
      } finally {
        done += 1;
        setCatalogRefreshProgress({ total: failedList.length, done, failed });
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    }
    await fetchSources();
    setCatalogRefreshing(false);
    toast.success(`Reprocessamento concluído: ${failedList.length - failed} ok, ${failed} com falha.`);
  };

  const handleCleanCache = async () => {
    if (!user) {
      toast("Faça login para limpar o cache.");
      return;
    }
    if (cacheCleaning) return;
    const ok = window.confirm(
      "Limpar cache do StudyLab?\n\nIsso remove materiais temporários (não definitivos) e conversas antigas do catálogo (se existirem). Materiais definitivos permanecem.",
    );
    if (!ok) return;
    setCacheCleaning(true);
    try {
      const resp = await apiFetch("/api/study?handler=clean-cache", { method: "POST" });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json?.success === false) {
        toast.error(json?.error || "Não foi possível limpar o cache.");
        return;
      }
      await fetchSources();
      toast.success(`Cache limpo: ${json.deleted || 0} itens removidos.`);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível limpar o cache.");
    } finally {
      setCacheCleaning(false);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!user) {
      toast("Faça login para remover materiais.");
      return;
    }
    const s = sources.find((row) => row.id === sourceId) || null;
    const name = s?.title?.trim() || "este material";
    const ok = window.confirm(`Apagar "${name}" do Catálogo?\n\nEssa ação não pode ser desfeita.`);
    if (!ok) return;
    try {
      const resp = await apiFetch("/api/study?handler=delete-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: sourceId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json?.success === false) {
        toast.error(json?.error || "Não foi possível apagar o material.");
        return;
      }
      if (selectedSourceId === sourceId) setSelectedSourceId(null);
      await fetchSources();
      toast.success("Material apagado.");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível apagar o material.");
    }
  };

  const handleChatSend = async () => {
    const trimmed = chatInput.trim();
    const attachmentsForMessage = chatAttachments.slice();
    if (!trimmed && attachmentsForMessage.length === 0) return;
    if (!user) {
      toast("Faça login para usar o chat de estudos.");
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

    const attachmentPrompt = getActiveLocale().toLowerCase().startsWith("en")
      ? "Analyze the attached files and answer using the study context."
      : "Analise os anexos enviados e responda usando o contexto de estudo.";
    const payloadQuestion = trimmed || (attachmentsForMessage.length ? attachmentPrompt : "");
    const displayContent = trimmed || (attachmentsForMessage.length ? "Anexos enviados." : "");
    const nextMessages = [
      ...chatMessages,
      { role: "user", content: displayContent, attachments: attachmentsForMessage } as ChatMessage,
    ];
    const payloadMessages = [
      ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: payloadQuestion },
    ];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    try {
      const controller = new AbortController();
      chatAbortRef.current = controller;
      const resp = await apiFetch("/api/ai?handler=study-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: oracleMode ? "oracle" : "study",
          ...(oracleMode ? {} : { source_id: selectedSourceId }),
          session_id: chatSessionId,
          attachments: attachmentsForMessage.map((url) => ({ url })),
          language: getActiveLocale(),
          save_compendium: false,
          ...(oracleMode ? { use_web: useWeb } : {}),
          quality: chatQuality,
          ...(kbEnabled && kbSelection?.tags?.length ? { kb_tags: kbSelection.tags, kb_focus: kbSelection.label } : {}),
          messages: payloadMessages,
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
      if (String(e?.name || "") === "AbortError") {
        setChatError("Geração interrompida.");
        return;
      }
      toast(`Erro no chat de estudos: ${e?.message || e}`);
    } finally {
      setChatLoading(false);
      chatAbortRef.current = null;
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

      <Card className="-mx-3 rounded-none sm:mx-0 sm:rounded-lg">
        <CardHeader className="space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4" />
                Chat
              </CardTitle>
              <CardDescription>
                {oracleMode
                  ? "Catálogo: busca na sua base + compêndio."
                  : selectedSource
                    ? `Material: ${selectedSource.title}`
                    : "Selecione um material no catálogo."}
              </CardDescription>
            </div>
          </div>

          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible sm:pb-0">
            <div className="flex shrink-0 items-center gap-1 rounded-full border p-1">
              <span className="pl-2 pr-1 text-[11px] font-medium text-muted-foreground">
                {t("studylab.gptModelLabel")}
              </span>
              <Button
                type="button"
                size="sm"
                variant={chatQuality === "auto" ? "default" : "ghost"}
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setChatQuality("auto")}
                disabled={chatLoading}
              >
                {t("studylab.gptModelAuto")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={chatQuality === "instant" ? "default" : "ghost"}
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setChatQuality("instant")}
                disabled={chatLoading}
                title={t("studylab.gptModelAutoFastHint")}
              >
                {t("studylab.gptModelAutoFast")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={chatQuality === "thinking" ? "default" : "ghost"}
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setChatQuality("thinking")}
                disabled={chatLoading}
                title={t("studylab.gptModelExtendedHint")}
              >
                {t("studylab.gptModelExtended")}
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5">
              <Switch
                id="studylab-catalog-toggle"
                checked={oracleMode}
                onCheckedChange={(checked) => {
                  setOracleMode(checked);
                  if (!checked) setUseWeb(false);
                  if (!checked && (!selectedSourceId || selectedSourceId === FIXED_RULES_ID)) {
                    setCatalogOpen(true);
                  }
                }}
              />
              <Label htmlFor="studylab-catalog-toggle" className="text-xs font-medium">
                Catálogo
              </Label>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5">
              <Switch
                id="studylab-web-toggle"
                checked={useWeb}
                onCheckedChange={setUseWeb}
                disabled={!oracleMode || chatLoading}
              />
              <Label htmlFor="studylab-web-toggle" className="text-xs font-medium">
                Pesquisa web
              </Label>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5">
              <Switch id="studylab-kb-toggle" checked={kbEnabled} onCheckedChange={setKbEnabled} />
              <Label htmlFor="studylab-kb-toggle" className="text-xs font-medium">
                {t("studylab.hashtagFocus")}
              </Label>
            </div>
            {!oracleMode && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setCatalogOpen(true)}
                >
                  Escolher material
                </Button>
                {selectedSource && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setSelectedSourceId(null)}
                  >
                    Limpar material
                  </Button>
                )}
              </>
            )}
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={handleNewChat}>
              Nova conversa
            </Button>
            {chatLoading && (
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={stopGenerating}>
                Parar
              </Button>
            )}
          </div>

          {kbEnabled && (
            <div className="rounded-md border p-3">
              <p className="mb-2 text-[11px] text-muted-foreground">
                {t("studylab.hashtagFocusHint")}
              </p>
              <ForumKbThemeMenu selection={kbSelection} onSelect={setKbSelection} />
            </div>
          )}
        </CardHeader>

        <CardContent className="flex flex-col gap-3 p-3 pt-0 sm:p-6 sm:pt-0">
          <div
            ref={chatViewportRef}
            className="min-h-[42vh] [@media(orientation:landscape)]:min-h-[32vh] sm:min-h-[55vh] overflow-y-auto rounded-md border bg-muted/30 p-2 sm:p-3"
          >
            {chatMessages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {oracleMode
                  ? "Pergunte qualquer coisa. O Catálogo responde usando sua base (e pesquisa online quando necessário)."
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
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.attachments.map((url, aIdx) =>
                        isImageUrl(url) ? (
                          <a key={`${url}-${aIdx}`} href={url} target="_blank" rel="noreferrer">
                            <img
                              src={url}
                              alt={getAttachmentLabel(url)}
                              className="h-20 w-24 rounded-md border object-cover"
                              loading="lazy"
                            />
                          </a>
                        ) : (
                          <a
                            key={`${url}-${aIdx}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border bg-background/80 px-2 py-1 text-xs text-foreground"
                          >
                            {getAttachmentLabel(url)}
                          </a>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="mb-2 flex justify-start">
                <div className="max-w-[70%] rounded-2xl border bg-background px-3 py-2 text-sm text-muted-foreground">
                  Pensando...
                </div>
              </div>
            )}
          </div>

          <div className="-mx-3 rounded-none border-x-0 border-t bg-background/60 px-3 py-2 sm:mx-0 sm:rounded-md sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
            <Textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onFocus={() => setChatInputFocused(true)}
              onBlur={() => setChatInputFocused(false)}
              placeholder={
                oracleMode
                  ? "Digite sua pergunta…"
                  : selectedSource
                    ? `Pergunte sobre: ${selectedSource.title}`
                    : "Selecione um material para perguntar"
              }
              rows={3}
              enterKeyHint="send"
              className="min-h-[120px] sm:min-h-[80px]"
              onKeyDown={(e) => {
                if ((e.nativeEvent as any)?.isComposing) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSend();
                }
              }}
            />

            <div className="mt-2 flex items-center gap-2">
              <Dialog open={chatAttachmentsOpen} onOpenChange={setChatAttachmentsOpen}>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="relative h-11 w-11 shrink-0"
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
                      Imagens, desenhos, PDFs e documentos ajudam o Catálogo a aprofundar a resposta. O StudyLab mantém um histórico de uso para consultas futuras.
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
                      capture="environment"
                      acceptMimeTypes={[
                        "application/pdf",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "application/vnd.ms-excel",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "text/plain",
                        "application/json",
                        "text/csv",
                        "image/heic",
                        "image/heif",
                        "image/jpeg",
                        "image/png",
                        "image/avif",
                        "image/webp",
                      ]}
                      maxVideoSeconds={0}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {chatUploading
                          ? "Enviando…"
                          : chatAttachments.length
                            ? `${chatAttachments.length} anexo(s) selecionado(s).`
                            : "Nenhum anexo selecionado."}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={resetChatAttachments}
                        disabled={!chatAttachments.length && !chatUploading}
                      >
                        Limpar
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <VoiceRecorderButton
                size="sm"
                label="Falar"
                className="shrink-0 [&_span]:hidden sm:[&_span]:inline"
                onText={(text) => setChatInput((prev) => [prev, text].filter(Boolean).join("\n\n"))}
              />

              <Button
                type="button"
                className="h-11 flex-1 sm:flex-none"
                onClick={handleChatSend}
                disabled={chatLoading || chatUploading || (!chatInput.trim() && chatAttachments.length === 0)}
              >
                {chatLoading ? "Pensando..." : "Enviar"}
              </Button>
            </div>

            <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">Enter envia • Shift+Enter quebra linha</p>
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
              <Input
                ref={catalogSearchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por título, resumo, tags, tema…"
              />
              <Button type="button" variant="outline" size="sm" onClick={clearCatalogFilters} disabled={!hasActiveCatalogFilters}>
                Limpar
              </Button>
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

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRecatalog}
                disabled={catalogRefreshing || ingesting || loadingSources}
              >
                Atualizar catálogo com IA
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleReingestFailed}
                disabled={catalogRefreshing || ingesting || loadingSources}
              >
                Reprocessar falhas
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCleanCache}
                disabled={cacheCleaning || catalogRefreshing || ingesting || loadingSources}
              >
                {cacheCleaning ? "Limpando…" : "Limpar cache"}
              </Button>
              {catalogRefreshing && catalogRefreshProgress ? (
                <span className="text-[11px] text-muted-foreground">
                  {catalogRefreshProgress.done}/{catalogRefreshProgress.total}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Recalcula títulos, resumos e temas a partir do conteúdo.
                </span>
              )}
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
                    const active = s.id === catalogPreviewId;
                    const isInChat = s.id === selectedSourceId && !oracleMode;
                    const isPublic = isPublicSource(s) || isFixedSource(s);
                    const visibilityLabel = isFixedSource(s) ? "FIXO" : isPublic ? "PÚBLICO" : "PRIVADO";
                    const topicKey = getSourceTopicKey(s);
                    const topicLabel = topicKey ? TOPIC_LABELS[topicKey] || topicKey : "";
                    const meta = getSourceMeta(s);
                    const subtitle = String(meta?.ai?.subtitle || meta?.subtitle || "").trim();
                    const ingestFailed = s.ingest_status === "failed";
                    const reingesting = reingestingSourceId === s.id;
                    const canDelete = !isFixedSource(s) && (isStaff || (user && s.user_id === user.id));
                    return (
                      <div
                        key={s.id}
                        className={[
                          "w-full rounded-md border p-3 text-left transition-colors",
                          active ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => setCatalogPreviewId(s.id)}
                            aria-label={`Pré-visualizar ${s.title?.trim() || "material"}`}
                          >
                            <p className="font-medium truncate">{s.title?.trim() || "Sem título"}</p>
                            {subtitle && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{subtitle}</p>}
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{displaySummary(s)}</p>
                            {ingestFailed && s.ingest_error && (
                              <p className="text-[11px] text-red-500/90 line-clamp-2 mt-1">{String(s.ingest_error).slice(0, 200)}</p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {visibilityLabel}
                              </Badge>
                              {isInChat && <Badge className="text-[10px]">em uso</Badge>}
                              <Badge variant="outline" className="text-[10px]">
                                {CATEGORY_LABELS[getSourceCategoryKey(s)] || "Outros"}
                              </Badge>
                              {topicLabel && (
                                <Badge variant="outline" className="text-[10px]">
                                  {topicLabel}
                                </Badge>
                              )}
                              {statusBadge(s)}
                            </div>
                          </button>

                          <div className="flex flex-col gap-2 shrink-0">
                            {s.url && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => window.open(s.url!, "_blank", "noreferrer")}
                              >
                                Abrir
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => useSourceInChat(s)}
                              disabled={s.ingest_status === "pending" || (s.ingest_status === "failed" && s.id !== FIXED_RULES_ID)}
                            >
                              Usar
                            </Button>
                            {canDelete && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                title="Apagar material"
                                onClick={() => handleDeleteSource(s.id)}
                                disabled={catalogRefreshing || ingesting || Boolean(reingestingSourceId)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            {!isFixedSource(s) && ingestFailed && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={reingesting || Boolean(reingestingSourceId) || catalogRefreshing || ingesting}
                                onClick={() => reingestSource(s.id)}
                              >
                                {reingesting ? "Reprocessando…" : "Reprocessar"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>

            {catalogPreviewSource ? (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!previewPrevId}
                      title="Anterior"
                      onClick={() => previewPrevId && setCatalogPreviewId(previewPrevId)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!previewNextId}
                      title="Próximo"
                      onClick={() => previewNextId && setCatalogPreviewId(previewNextId)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <p className="text-sm font-medium">Prévia</p>
                    {previewIndex >= 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {previewIndex + 1}/{visibleSources.length}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {catalogPreviewSource.url && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(catalogPreviewSource.url!, "_blank", "noreferrer")}
                      >
                        Abrir
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => useSourceInChat(catalogPreviewSource)}
                      disabled={
                        catalogPreviewSource.ingest_status === "pending" ||
                        (catalogPreviewSource.ingest_status === "failed" && catalogPreviewSource.id !== FIXED_RULES_ID)
                      }
                    >
                      Usar no chat
                    </Button>
                    {studioAccess && catalogPreviewSource.id !== FIXED_RULES_ID && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/studio?module=quiz&seed_source=${catalogPreviewSource.id}`)}
                      >
                        Criar quiz
                      </Button>
                    )}
                    {catalogPreviewSource.id !== FIXED_RULES_ID && (isStaff || (user && catalogPreviewSource.user_id === user.id)) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteSource(catalogPreviewSource.id)}
                      >
                        Apagar
                      </Button>
                    )}
                  </div>
                </div>
                {catalogPreviewSource.ingest_status === "failed" && catalogPreviewSource.id !== FIXED_RULES_ID && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-red-500/90">Este material falhou na curadoria.</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(reingestingSourceId) || catalogRefreshing || ingesting}
                      onClick={() => reingestSource(catalogPreviewSource.id)}
                    >
                      {reingestingSourceId === catalogPreviewSource.id ? "Reprocessando…" : "Reprocessar"}
                    </Button>
                  </div>
                )}
                {catalogPreviewSource.summary && (
                  <p className="text-xs text-muted-foreground whitespace-pre-line">{catalogPreviewSource.summary}</p>
                )}
                {(() => {
                  const meta =
                    catalogPreviewSource.metadata && typeof catalogPreviewSource.metadata === "object"
                      ? catalogPreviewSource.metadata
                      : null;
                  const outline = meta?.ai?.outline || meta?.outline || [];
                  if (!Array.isArray(outline) || outline.length === 0) return null;
                  return <div className="mt-2">{renderOutline(outline)}</div>;
                })()}
              </div>
            ) : (
              <div className="rounded-md border p-3">
                <p className="text-sm text-muted-foreground">
                  Selecione um material na lista para ver detalhes e usar no chat.
                </p>
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
