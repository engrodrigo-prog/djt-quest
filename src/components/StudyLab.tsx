import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { apiFetch } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/activeLocale";

import { ChatPanel } from "@/components/studylab/ChatPanel";
import type { ChatMessage, ChatMessageMeta } from "@/components/studylab/ChatPanel";
import { CatalogSheet } from "@/components/studylab/CatalogSheet";
import { HistoryDrawer } from "@/components/studylab/HistoryDrawer";
import { ProgressCards } from "@/components/studylab/ProgressCards";
import { SourcesPanel } from "@/components/studylab/SourcesPanel";
import { StudyLabHeader } from "@/components/studylab/StudyLabHeader";
import { StudyLabProvider, useStudyLab } from "@/components/studylab/StudyLabProvider";
import { UploadSheet } from "@/components/studylab/UploadSheet";
import type { ForumKbSelection } from "@/components/ForumKbThemeSelector";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  EMPTY_INCIDENT,
  FIXED_RULES_ID,
  FIXED_SOURCES,
  PRIVATE_TTL_DAYS,
  TOPIC_LABELS,
  getSourceCategoryKey,
  getSourceMeta,
  getSourceTopicKey,
  isChatCompendiumSource,
  isFixedSource,
  isPrivateSource,
  isPublicSource,
  normalizeCategory,
} from "@/components/studylab/catalog-utils";
import type { IncidentForm, StudyCategory, StudyScope, StudySource } from "@/components/studylab/catalog-utils";

type ChatSessionSummary = {
  id: string;
  title: string | null;
  summary: string | null;
  mode: string | null;
  source_id: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type StudyChatApiMeta = {
  truncated?: boolean;
  incomplete_reason?: string | null;
};

type StudyChatApiResponse = {
  success?: boolean;
  answer?: string;
  content?: string;
  session_id?: string;
  meta?: StudyChatApiMeta;
  error?: string;
};

const parseAttachmentUrls = (raw: any): string[] => {
  const items = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const url =
      typeof item === "string"
        ? item.trim()
        : String(item?.url || item?.publicUrl || item?.href || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
};

const normalizeStoredChatMessages = (rawMessages: any, fallbackAttachments: any): ChatMessage[] => {
  const rows = Array.isArray(rawMessages) ? rawMessages : [];
  const fallback = parseAttachmentUrls(fallbackAttachments);
  const mapped: ChatMessage[] = [];
  let hasAnyAttachment = false;

  for (const item of rows) {
    const role = String(item?.role || "").trim().toLowerCase() === "assistant" ? "assistant" : "user";
    const content = String(item?.content || "").trim();
    if (!content) continue;
    const attachments = parseAttachmentUrls(item?.attachments);
    if (attachments.length) hasAnyAttachment = true;
    mapped.push(attachments.length ? { role, content, attachments } : { role, content });
  }

  if (!hasAnyAttachment && fallback.length && mapped.length) {
    const firstUserIdx = mapped.findIndex((m) => m.role === "user");
    if (firstUserIdx >= 0) {
      mapped[firstUserIdx] = { ...mapped[firstUserIdx], attachments: fallback };
    }
  }

  return mapped;
};

const createChatSessionId = () => {
  if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
    return (crypto as any).randomUUID();
  }
  return `studychat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

function StudyLabInner() {
  const { user, studioAccess, roles } = useAuth();
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
  const [catalogTab, setCatalogTab] = useState<"tree" | "list">("list");
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
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [chatSessionsLoading, setChatSessionsLoading] = useState(false);
  const [chatSessionsError, setChatSessionsError] = useState<string | null>(null);
  const [chatHistoryClearing, setChatHistoryClearing] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [chatHistorySearch, setChatHistorySearch] = useState("");
  const [chatSessionLoadingId, setChatSessionLoadingId] = useState<string | null>(null);
  const [chatAttachments, setChatAttachments] = useState<string[]>([]);
  const [chatUploading, setChatUploading] = useState(false);
  const [chatUploadKey, setChatUploadKey] = useState(0);
  const [chatSessionId, setChatSessionId] = useState<string>(() => createChatSessionId());
  const [chatAttachmentsOpen, setChatAttachmentsOpen] = useState(false);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  const { activeSources, addActiveSource, clearActiveSources } = useStudyLab();
  // oracleMode é agora derivado: sem fontes ativas = modo oracle
  const oracleMode = activeSources.length === 0;
  const [useWeb, setUseWeb] = useState(false);
  const [chatQuality, setChatQuality] = useState<"auto" | "instant" | "thinking">("instant");
  const [kbEnabled, setKbEnabled] = useState(false);
  const [kbSelection, setKbSelection] = useState<ForumKbSelection | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const didAutoLoadSessionRef = useRef(false);
  const [chatInputFocused, setChatInputFocused] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  const openConfirm = useCallback(
    (title: string, description: string, onConfirm: () => void) => {
      setConfirmDialog({ open: true, title, description, onConfirm });
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia?.("(max-width: 768px)")?.matches ?? false;
    window.dispatchEvent(new CustomEvent("djt-nav-visibility", { detail: { hidden: Boolean(isMobile && chatInputFocused) } }));
    if (chatInputFocused && isMobile) {
      setTimeout(() => {
        try {
          chatInputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch {
          // ignore
        }
      }, 320);
    }
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
    setCatalogPreviewId(null);
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

  // Auto-poll: se há materiais em "pending", verifica a cada 5s até todos serem processados
  useEffect(() => {
    const hasPending = sources.some((s) => s.ingest_status === "pending");
    if (!hasPending || loadingSources || ingesting) return;
    const timer = setTimeout(() => fetchSources(), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, loadingSources, ingesting]);

  const fetchChatSessions = useCallback(async () => {
    if (!user?.id) {
      setChatSessions([]);
      setChatSessionsError(null);
      return;
    }
    setChatSessionsLoading(true);
    setChatSessionsError(null);
    try {
      const { data, error } = await (supabase as any)
        .from("study_chat_sessions")
        .select("id, title, summary, mode, source_id, updated_at, created_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(120);
      if (error) throw error;
      setChatSessions(Array.isArray(data) ? (data as ChatSessionSummary[]) : []);
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (/study_chat_sessions|relation/i.test(msg)) {
        setChatSessionsError("Histórico indisponível (migração do banco não aplicada).");
      } else {
        setChatSessionsError("Falha ao carregar histórico.");
        console.warn("StudyLab: erro ao carregar histórico", msg || e);
      }
      setChatSessions([]);
    } finally {
      setChatSessionsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    didAutoLoadSessionRef.current = false;
    setChatHistorySearch("");
    if (!user?.id) {
      setChatSessions([]);
      return;
    }
    void fetchChatSessions();
  }, [fetchChatSessions, user?.id]);

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
    const subtitle = String(meta?.ai?.subtitle || meta?.subtitle || "").trim();
    const tags = Array.isArray(meta?.tags) ? meta.tags : Array.isArray(meta?.ai?.tags) ? meta.ai.tags : [];
    const topicKey = getSourceTopicKey(s);
    const categoryKey = getSourceCategoryKey(s);
    const hay = [
      s.title || "",
      s.summary || "",
      s.url || "",
      subtitle,
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
    const filtered = allSources.filter((s) => {
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

    const ts = (s: StudySource) => {
      const raw = s.last_used_at || s.created_at;
      const parsed = Date.parse(String(raw || ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const searchScore = (s: StudySource, query: string) => {
      if (!query) return 0;
      const meta = getSourceMeta(s);
      const title = String(s.title || "").toLowerCase();
      const summary = String(s.summary || "").toLowerCase();
      const url = String(s.url || "").toLowerCase();
      const subtitle = String(meta?.ai?.subtitle || meta?.subtitle || "").toLowerCase();
      const tags = Array.isArray(meta?.tags) ? meta.tags : Array.isArray(meta?.ai?.tags) ? meta.ai.tags : [];
      const tagsHay = tags.map((t) => String(t || "")).join(" ").toLowerCase();

      let score = 0;
      if (title.includes(query)) score += 24;
      if (subtitle.includes(query)) score += 14;
      if (summary.includes(query)) score += 9;
      if (tagsHay.includes(query)) score += 7;
      if (url.includes(query)) score += 2;
      if (s.ingest_status === "ok") score += 2;
      if (s.ingest_status === "pending") score -= 1;
      if (s.ingest_status === "failed") score -= 4;
      return score;
    };

    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      if (q) {
        const sa = searchScore(a, q);
        const sb = searchScore(b, q);
        if (sa !== sb) return sb - sa;
      }
      const ta = ts(a);
      const tb = ts(b);
      if (ta !== tb) return tb - ta;
      const aa = String(a.title || "").localeCompare(String(b.title || ""), getActiveLocale(), { sensitivity: "base" });
      return aa;
    });

    return sorted;
  }, [allSources, categoryFilter, search, topicFilter, user, visibilityFilter]);

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

  const selectSourceForChat = (source: StudySource) => {
    if (!source) return;
    if (source.id === FIXED_RULES_ID) {
      clearActiveSources();
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
    addActiveSource(source.id);
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

  const resetChatAttachments = useCallback(() => {
    setChatAttachments([]);
    setChatUploadKey((prev) => prev + 1);
  }, []);

  const openChatSession = useCallback(
    async (sessionId: string, opts?: { silent?: boolean }) => {
      const sid = String(sessionId || "").trim();
      if (!sid || !user?.id) return;
      setChatSessionLoadingId(sid);
      try {
        const { data, error } = await (supabase as any)
          .from("study_chat_sessions")
          .select("id, mode, source_id, messages, attachments, metadata")
          .eq("id", sid)
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          if (!opts?.silent) toast.error("Conversa não encontrada.");
          return;
        }

        const mode = String(data?.mode || "study").toLowerCase();
        const isOracle = mode === "oracle";
        const sourceId = typeof data?.source_id === "string" ? data.source_id : null;
        const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : null;
        const restoredMessages = normalizeStoredChatMessages(data?.messages, data?.attachments);

        try {
          chatAbortRef.current?.abort();
        } catch {
          // ignore
        }
        chatAbortRef.current = null;
        setChatLoading(false);
        setChatError(null);
        setChatInput("");
        setChatMessages(restoredMessages);
        setChatSessionId(sid);
        setUseWeb(Boolean(metadata?.use_web) && isOracle);
        setSelectedSourceId(!isOracle ? sourceId : null);
        if (!isOracle && sourceId) addActiveSource(sourceId);
        else clearActiveSources();
        resetChatAttachments();
        setChatHistoryOpen(false);
      } catch (e: any) {
        if (!opts?.silent) toast.error(e?.message || "Falha ao abrir conversa.");
      } finally {
        setChatSessionLoadingId(null);
      }
    },
    [resetChatAttachments, user?.id, addActiveSource, clearActiveSources],
  );

  const handleDeleteChatSession = useCallback(
    (sessionId: string) => {
      const sid = String(sessionId || "").trim();
      if (!sid || !user?.id) return;
      const row = chatSessions.find((s) => s.id === sid);
      const label = String(row?.title || row?.summary || "esta conversa").trim();
      openConfirm(
        `Apagar conversa`,
        `Apagar "${label}" do histórico? Essa ação não pode ser desfeita.`,
        async () => {
          try {
            const { error } = await (supabase as any)
              .from("study_chat_sessions")
              .delete()
              .eq("id", sid)
              .eq("user_id", user!.id);
            if (error) throw error;
            setChatSessions((prev) => prev.filter((s) => s.id !== sid));
            if (chatSessionId === sid) {
              try {
                chatAbortRef.current?.abort();
              } catch {
                // ignore
              }
              chatAbortRef.current = null;
              setChatLoading(false);
              setChatError(null);
              setChatMessages([]);
              setChatInput("");
              setChatSessionId(createChatSessionId());
              resetChatAttachments();
              didAutoLoadSessionRef.current = true;
            }
          } catch (e: any) {
            toast.error(e?.message || "Falha ao apagar conversa.");
          }
        },
      );
    },
    [chatSessions, chatSessionId, user?.id, openConfirm, resetChatAttachments],
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, newTitle: string) => {
      if (!user?.id) return;
      const { error } = await (supabase as any)
        .from("study_chat_sessions")
        .update({ title: newTitle })
        .eq("id", sessionId)
        .eq("user_id", user.id);
      if (error) {
        toast.error(error.message || "Falha ao renomear conversa.");
        throw error;
      }
      setChatSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)),
      );
    },
    [user?.id],
  );

  useEffect(() => {
    if (!user?.id || didAutoLoadSessionRef.current || chatSessionsLoading) return;
    if (chatMessages.length > 0 || chatInput.trim()) return;
    const first = chatSessions[0];
    if (!first?.id) return;
    didAutoLoadSessionRef.current = true;
    void openChatSession(first.id, { silent: true });
  }, [chatInput, chatMessages.length, chatSessions, chatSessionsLoading, openChatSession, user?.id]);

  const handleNewChat = useCallback(() => {
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
    setChatHistoryOpen(false);
    didAutoLoadSessionRef.current = true;
    resetChatAttachments();
  }, [resetChatAttachments]);

  const handleClearAllChatHistory = useCallback(async () => {
    if (!user?.id) return;
    if (chatHistoryClearing) return;
    if (chatSessionsLoading) return;
    const count = chatSessions.length;
    if (count === 0) {
      toast("Nenhuma conversa para apagar.");
      return;
    }

    openConfirm(
      `Apagar todo o histórico`,
      `Isso remove ${count} conversa(s) do seu histórico. Essa ação não pode ser desfeita.`,
      async () => {
        setChatHistoryClearing(true);
        try {
          const { error } = await (supabase as any)
            .from("study_chat_sessions")
            .delete()
            .eq("user_id", user!.id);
          if (error) throw error;
          setChatSessions([]);
          setChatHistorySearch("");
          handleNewChat();
          toast.success("Histórico apagado.");
        } catch (e: any) {
          toast.error(e?.message || "Falha ao apagar histórico.");
        } finally {
          setChatHistoryClearing(false);
        }
      },
    );
  }, [chatHistoryClearing, chatSessions.length, chatSessionsLoading, handleNewChat, openConfirm, user?.id]);

  const mergeAssistantContinuation = (previous: string, extra: string) => {
    const a = String(previous || "").replace(/\s+$/g, "");
    const b = String(extra || "").replace(/^\s+/g, "");
    if (!a) return b;
    if (!b) return a;
    const sep = a.endsWith("\n") || b.startsWith("\n") ? "\n" : "\n\n";
    return `${a}${sep}${b}`.trim();
  };

  const handleContinueFromTruncated = useCallback(
    async (assistantIndex: number) => {
      if (!user) {
        toast("Faça login para usar o chat de estudos.");
        return;
      }
      if (chatLoading || chatUploading || chatHistoryClearing) return;
      const target = chatMessages[assistantIndex];
      if (!target || target.role !== "assistant") return;

      const effectiveSourceId =
        !oracleMode && selectedSourceId && selectedSourceId !== FIXED_RULES_ID ? selectedSourceId : null;
      const continuePrompt = getActiveLocale().toLowerCase().startsWith("en")
        ? "Continue from where you stopped. Do not repeat what was already said."
        : "Continue de onde parou. Não repita o que já foi dito.";

      const payloadMessages = [
        ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: continuePrompt },
      ];

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
            ...(oracleMode ? {} : effectiveSourceId ? { source_id: effectiveSourceId } : {}),
            ...(activeSources.length > 0 ? { source_ids: activeSources.map((s) => s.id) } : {}),
            session_id: chatSessionId,
            attachments: [],
            language: getActiveLocale(),
            save_compendium: false,
            ...(oracleMode ? { use_web: useWeb } : {}),
            quality: chatQuality,
            ...(kbEnabled && kbSelection?.tags?.length ? { kb_tags: kbSelection.tags, kb_focus: kbSelection.label } : {}),
            messages: payloadMessages,
          }),
        });

        const json = (await resp.json().catch(() => ({}))) as StudyChatApiResponse;
        if (!resp.ok || json?.success === false) {
          setChatError(json?.error || "Falha no chat de estudos");
          return;
        }
        const answer = String(json.answer || json.content || "").trim();
        if (!answer) {
          setChatError("A IA retornou uma resposta vazia.");
          return;
        }
        if (typeof json?.session_id === "string" && json.session_id.trim()) {
          setChatSessionId(json.session_id.trim());
        }

        const truncated = Boolean(json?.meta?.truncated);
        const incompleteReason =
          typeof json?.meta?.incomplete_reason === "string" ? json.meta.incomplete_reason : null;

        setChatMessages((prev) => {
          const next = prev.slice();
          const cur = next[assistantIndex];
          if (!cur || cur.role !== "assistant") return prev;
          const merged = mergeAssistantContinuation(cur.content, answer);
          const meta: ChatMessageMeta = { ...(cur.meta || {}), truncated, incomplete_reason: incompleteReason };
          next[assistantIndex] = { ...cur, content: merged, meta };
          return next;
        });

        void fetchChatSessions();
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
    },
    [
      activeSources,
      chatHistoryClearing,
      chatLoading,
      chatMessages,
      chatQuality,
      chatSessionId,
      chatUploading,
      kbEnabled,
      kbSelection?.label,
      kbSelection?.tags,
      oracleMode,
      selectedSourceId,
      user,
      useWeb,
      fetchChatSessions,
    ],
  );

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
    openConfirm(
      "Limpar cache do StudyLab",
      "Isso remove materiais temporários (não definitivos) e conversas antigas do catálogo. Materiais definitivos permanecem.",
      async () => {
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
      },
    );
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!user) {
      toast("Faça login para remover materiais.");
      return;
    }
    const s = sources.find((row) => row.id === sourceId) || null;
    const name = s?.title?.trim() || "este material";
    openConfirm(
      `Apagar material`,
      `Apagar "${name}" do Catálogo? Essa ação não pode ser desfeita.`,
      async () => {
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
      },
    );
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

    const effectiveSourceId =
      !oracleMode && selectedSourceId && selectedSourceId !== FIXED_RULES_ID ? selectedSourceId : null;

    if (!oracleMode && selectedSourceId === FIXED_RULES_ID) {
      toast.error("Use o Catálogo para perguntar sobre o artigo fixo.");
      setSelectedSourceId(null);
    }

    if (!oracleMode && effectiveSourceId) {
      const sel = sources.find((s) => s.id === effectiveSourceId);
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
          ...(oracleMode ? {} : effectiveSourceId ? { source_id: effectiveSourceId } : {}),
          ...(activeSources.length > 0 ? { source_ids: activeSources.map((s) => s.id) } : {}),
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
      const json = (await resp.json().catch(() => ({}))) as StudyChatApiResponse;
      if (!resp.ok || json?.success === false) {
        setChatError(json?.error || "Falha no chat de estudos");
        return;
      }
      const answer = String(json.answer || json.content || "").trim();
      if (!answer) {
        setChatError("A IA retornou uma resposta vazia.");
        return;
      }
      if (typeof json?.session_id === "string" && json.session_id.trim()) {
        setChatSessionId(json.session_id.trim());
      }
      const truncated = Boolean(json?.meta?.truncated);
      const incompleteReason =
        typeof json?.meta?.incomplete_reason === "string" ? json.meta.incomplete_reason : null;
      const meta: ChatMessageMeta | undefined = truncated || incompleteReason ? { truncated, incomplete_reason: incompleteReason } : undefined;
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer, ...(meta ? { meta } : {}) }]);
      resetChatAttachments();
      void fetchChatSessions();
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
      <StudyLabHeader
        onOpenHistory={() => setChatHistoryOpen(true)}
        onOpenCatalog={() => setCatalogOpen(true)}
        onOpenUpload={() => setUploadOpen(true)}
      />

      <ProgressCards
        ingesting={ingesting}
        catalogRefreshing={catalogRefreshing}
        catalogRefreshProgress={catalogRefreshProgress}
      />

      <div className="grid gap-4 lg:grid-cols-[280px_240px_minmax(0,1fr)]">
      <HistoryDrawer
        sessions={chatSessions}
        loading={chatSessionsLoading}
        error={chatSessionsError}
        currentSessionId={chatSessionId}
        loadingSessionId={chatSessionLoadingId}
        chatLoading={chatLoading}
        chatUploading={chatUploading}
        historyClearing={chatHistoryClearing}
        search={chatHistorySearch}
        onSearchChange={setChatHistorySearch}
        onSelect={(id) => void openChatSession(id)}
        onNewChat={handleNewChat}
        onDelete={handleDeleteChatSession}
        onClearAll={handleClearAllChatHistory}
        onRename={handleRenameSession}
        open={chatHistoryOpen}
        onOpenChange={setChatHistoryOpen}
      />

      {/* SourcesPanel — second left column (desktop only; mobile uses catalog Sheet) */}
      <div className="hidden lg:flex lg:flex-col lg:sticky lg:top-4 rounded-lg border bg-card p-3 h-[calc(100vh-8rem)]">
        <SourcesPanel
          sources={allSources}
          loadingSources={loadingSources}
          onOpenUpload={() => setUploadOpen(true)}
          onOpenCatalog={() => setCatalogOpen(true)}
        />
      </div>

      <ChatPanel
        messages={chatMessages}
        loading={chatLoading}
        uploading={chatUploading}
        error={chatError}
        viewportRef={chatViewportRef}
        inputRef={chatInputRef}
        input={chatInput}
        onInputChange={setChatInput}
        onInputFocus={() => setChatInputFocused(true)}
        onInputBlur={() => setChatInputFocused(false)}
        inputFocused={chatInputFocused}
        oracleMode={oracleMode}
        activeSources={activeSources}
        selectedSourceTitle={selectedSource?.title ?? null}
        quality={chatQuality}
        onQualityChange={setChatQuality}
        useWeb={useWeb}
        onUseWebChange={setUseWeb}
        kbEnabled={kbEnabled}
        onKbEnabledChange={setKbEnabled}
        kbSelection={kbSelection}
        onKbSelectionChange={setKbSelection}
        attachments={chatAttachments}
        onAttachmentsChange={setChatAttachments}
        attachmentsOpen={chatAttachmentsOpen}
        onAttachmentsOpenChange={setChatAttachmentsOpen}
        uploadKey={chatUploadKey}
        onUploadingChange={setChatUploading}
        onResetAttachments={resetChatAttachments}
        onSend={handleChatSend}
        onContinueFromTruncated={handleContinueFromTruncated}
        onNewChat={handleNewChat}
        onStop={stopGenerating}
        onOpenCatalog={() => setCatalogOpen(true)}
        onOpenUpload={() => setUploadOpen(true)}
        onClearSource={() => setSelectedSourceId(null)}
      />
      </div>

      <CatalogSheet
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        tab={catalogTab}
        onTabChange={setCatalogTab}
        search={search}
        onSearchChange={setSearch}
        searchRef={catalogSearchRef}
        hasActiveFilters={hasActiveCatalogFilters}
        onClearFilters={clearCatalogFilters}
        visibilityFilter={visibilityFilter}
        onVisibilityFilterChange={setVisibilityFilter}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        topicFilter={topicFilter}
        onTopicFilterChange={setTopicFilter}
        isStaff={isStaff}
        refreshing={catalogRefreshing}
        refreshProgress={catalogRefreshProgress}
        ingesting={ingesting}
        loadingSources={loadingSources}
        onRecatalog={handleRecatalog}
        onReingestFailed={handleReingestFailed}
        cacheCleaning={cacheCleaning}
        onCleanCache={handleCleanCache}
        sources={visibleSources}
        topicsByCategory={topicsByCategory}
        selectedSourceId={selectedSourceId}
        oracleMode={oracleMode}
        previewId={catalogPreviewId}
        onPreviewIdChange={setCatalogPreviewId}
        previewSource={catalogPreviewSource}
        previewPrevId={previewPrevId}
        previewNextId={previewNextId}
        previewIndex={previewIndex}
        sourcesCount={visibleSources.length}
        reingestingSourceId={reingestingSourceId}
        studioAccess={Boolean(studioAccess)}
        userId={user?.id ?? null}
        onSelectSource={selectSourceForChat}
        onDeleteSource={handleDeleteSource}
        onReingestSource={reingestSource}
        onNavigateToQuiz={(id) => navigate(`/studio?module=quiz&seed_source=${id}`)}
      />

      <UploadSheet
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        category={newCategory}
        onCategoryChange={setNewCategory}
        visibility={newVisibility}
        onVisibilityChange={setNewVisibility}
        incident={incident}
        onIncidentChange={setIncident}
        url={url}
        onUrlChange={setUrl}
        adding={adding}
        onAdd={handleAddSource}
        onFilesUploaded={handleFilesUploaded}
      />

      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && setConfirmDialog((prev) => ({ ...prev, open: false }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog((prev) => ({ ...prev, open: false }));
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const StudyLab = () => (
  <StudyLabProvider>
    <StudyLabInner />
  </StudyLabProvider>
);
