import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { BookOpenCheck, Link as LinkIcon, MessageCircle, AlertCircle, Trash2 } from "lucide-react";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  is_persistent: boolean;
  created_at: string;
  last_used_at: string | null;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

export const StudyLab = ({ showOrgCatalog = false }: { showOrgCatalog?: boolean }) => {
  const { user, isLeader } = useAuth();
  const [sources, setSources] = useState<StudySource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [adding, setAdding] = useState(false);
   const [ingesting, setIngesting] = useState(false);

  const [url, setUrl] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [polling, setPolling] = useState(false);

  const fetchSources = async () => {
    if (!user) return;
    try {
      setLoadingSources(true);
      const { data, error } = await supabase
        .from("study_sources")
        .select("id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at")
        .order("created_at", { ascending: false });
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
    setAdding(true);
    try {
      const inserts = urls.map((u) => {
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
        };
      });
      const { data, error } = await supabase
        .from("study_sources")
        .insert(inserts)
        .select("id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at");
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
        setShowUploader(false);
      }
    } catch (e: any) {
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
    setAdding(true);
    try {
      const finalTitle = deriveTitleFromUrl(link);
      const finalDesc = deriveSummaryFromUrl(link);
      const { data, error } = await supabase
        .from("study_sources")
        .insert({
          user_id: user.id,
          title: finalTitle,
          kind: "url",
          url: link,
          summary: finalDesc,
          ingest_status: "pending",
          is_persistent: true,
          last_used_at: new Date().toISOString(),
        })
        .select("id, user_id, title, kind, url, storage_path, summary, ingest_status, ingested_at, ingest_error, topic, is_persistent, created_at, last_used_at")
        .maybeSingle();
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
          mode: "study",
          source_id: selectedSourceId,
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
        await supabase.from("study_sources").update({ last_used_at: new Date().toISOString() }).eq("id", selectedSourceId);
      } catch {
        /* silencioso */
      }
    } catch (e: any) {
      toast(`Erro no chat de estudos: ${e?.message || e}`);
    } finally {
      setChatLoading(false);
    }
  };

  const mySources = user ? sources.filter((s) => s.user_id === user.id) : sources;
  const orgSources = showOrgCatalog && isLeader && user
    ? sources.filter(
        (s) =>
          s.user_id !== user.id &&
          (!selectedSourceId || s.id !== selectedSourceId)
      )
    : [];

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

  const TOPIC_ORDER = [
    "LINHAS",
    "SUBESTACOES",
    "PROCEDIMENTOS",
    "PROTECAO",
    "AUTOMACAO",
    "TELECOM",
    "SEGURANCA_DO_TRABALHO",
    "OUTROS",
  ];

  const groupByTopic = (list: StudySource[]) => {
    const groups: Record<string, StudySource[]> = {};
    for (const s of list) {
      const raw = (s.topic || "OUTROS").toUpperCase().replace(/\s+/g, "_");
      const key = TOPIC_ORDER.includes(raw) ? raw : "OUTROS";
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  };

  const myByTopic = groupByTopic(mySources);

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
            <CardTitle className="text-white">Materiais de estudo</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="Observação" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/30 text-white/80 hover:border-white/60">
                    <AlertCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Materiais inativos por 30 dias são limpos automaticamente.</p>
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
            Selecione um material para usá-lo como contexto do chat. Materiais inativos por 30 dias são limpos automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-h-[520px] overflow-y-auto text-white">
          {showUploader && (
            <div className="rounded-lg border border-white/20 bg-white/5 p-4 space-y-4">
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
                <Label className="text-white">Ou envie um documento (PDF, Word, Excel)</Label>
                <AttachmentUploader
                  onAttachmentsChange={handleFilesUploaded}
                  maxFiles={3}
                  maxSizeMB={20}
                  bucket="evidence"
                  pathPrefix="study"
                  acceptMimeTypes={[
                    "application/pdf",
                    "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.ms-excel",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  ]}
                  maxVideoSeconds={0}
                />
                <p className="text-xs text-white/80">
                  Materiais inativos por 30 dias sem consulta saem automaticamente do catálogo.
                </p>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-white/80">Seus materiais</p>
            {loadingSources && <p className="text-sm text-white/70">Carregando sua base de estudos...</p>}
            {!loadingSources && mySources.length === 0 && (
              <p className="text-sm text-white/70">Nenhum material salvo ainda. Use o botão acima para adicionar.</p>
            )}
            {TOPIC_ORDER.map((key) => {
              const items = myByTopic[key];
              if (!items || !items.length) return null;
              return (
                <div key={key} className="space-y-1">
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-white/60">
                    {TOPIC_LABELS[key] ?? key}
                  </p>
                  {items.map((s) => {
                    const isActive = s.id === selectedSourceId;
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
                        {new Date(s.created_at).toLocaleString("pt-BR")}
                      </p>
                      {statusBadge(s)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] border-white/50 text-white">
                        {s.kind.toUpperCase()}
                      </Badge>
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

      {showOrgCatalog && orgSources.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-white/20">
          <p className="text-xs font-semibold text-white/80">Da organização</p>
          {orgSources.map((s) => (
            <div key={s.id} className="rounded-md border border-white/30 bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold leading-tight text-white">
                      {s.title?.trim() || deriveTitleFromUrl(s.url || "")}
                    </p>
                    <Badge variant="outline" className="text-[10px] border-white/50 text-white">
                      {s.kind.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-white/70">
                    {new Date(s.created_at).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-sm text-white mt-1 line-clamp-2">
                    {displaySummary(s)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chat de Estudos */}
      <Card className="bg-white/5 border border-white/20 text-white shadow-xl backdrop-blur-md">
        <CardHeader className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <BookOpenCheck className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl font-semibold leading-tight text-white">Chat de Estudos</CardTitle>
              <CardDescription className="text-white/80">Converse com a IA sobre o material selecionado no catálogo.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 text-white">

          <div className="space-y-3">
            <Label className="text-white">Pergunta para a IA</Label>
            <div className="border border-white/20 rounded-md p-3 max-h-72 overflow-y-auto bg-white/5 text-sm">
              {chatMessages.length === 0 && (
                <p className="text-white/70 text-xs">
                  Selecione um material no catálogo acima e faça uma pergunta. A IA usa o conteúdo selecionado como contexto.
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
                  selectedSource ? `Pergunte sobre: ${selectedSource.title}` : "Selecione um material para perguntar"
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
              A IA prioriza o material selecionado no catálogo e as mensagens desta conversa.
            </p>
          </div>
        </CardContent>
      </Card>

    </div>
  );
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
        });
        await fetchSources();
      }
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível reprocessar agora.");
    } finally {
      setIngesting(false);
    }
  };
