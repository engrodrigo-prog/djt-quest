import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { AttachmentViewer } from "@/components/AttachmentViewer";
import { ThemedBackground } from "@/components/ThemedBackground";
import Navigation from "@/components/Navigation";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Heart, Trash2, MapPin, Wand2, Send, Flame, Plus, Hash, Pencil, Share2 } from "lucide-react";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";

interface SepPost {
  id: string;
  user_id: string;
  author_name: string;
  author_team?: string | null;
   author_avatar?: string | null;
   author_base?: string | null;
  content_md: string;
  attachments?: string[];
  like_count: number;
  comment_count: number;
  created_at: string;
  location_label?: string | null;
  has_liked?: boolean;
  campaign?: { id: string; title: string | null } | null;
  participants?: { id: string; name: string; sigla_area?: string | null }[];
}

interface SepComment {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string;
  author_team?: string | null;
  author_avatar?: string | null;
  author_base?: string | null;
  content_md: string;
  created_at: string;
}

interface CampaignOption {
  id: string;
  title: string;
}

export default function SEPBook() {
  const { user, profile, isLeader } = useAuth();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [posts, setPosts] = useState<SepPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [useLocation, setUseLocation] = useState(false);
  const [askedLocationOnce, setAskedLocationOnce] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const v = localStorage.getItem("sepbook_location_asked");
      return v === "1";
    } catch {
      return false;
    }
  });
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, SepComment[]>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [loadingComments, setLoadingComments] = useState<Record<string, boolean>>({});
  const [newComment, setNewComment] = useState<Record<string, string>>({});
  const [trendRange, setTrendRange] = useState<"week" | "month" | "quarter" | "semester" | "year">("week");
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingTags, setTrendingTags] = useState<any[]>([]);
  const [trendingTagsAll, setTrendingTagsAll] = useState<any[]>([]);
  const [trendingAI, setTrendingAI] = useState<any | null>(null);
  const [showTrending, setShowTrending] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const [editingNewAttachments, setEditingNewAttachments] = useState<string[]>([]);
  const [tagsSuggestions, setTagsSuggestions] = useState<{ tag: string; label: string; kind: string }[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string>("");
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([]);
  const [hashtagSuggestions, setHashtagSuggestions] = useState<string[]>([]);
  const [hashtagLoading, setHashtagLoading] = useState(false);
  const [cleaningPostId, setCleaningPostId] = useState<string | null>(null);
  const [campaignOptions, setCampaignOptions] = useState<CampaignOption[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [participantOptions, setParticipantOptions] = useState<Array<{ id: string; name: string; sigla_area: string | null }>>([]);
  const [participantSearch, setParticipantSearch] = useState("");

  const formatName = (name: string | null | undefined) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return parts.join(" ");
    return `${parts[0]} ${parts[parts.length - 1]}`;
  };

  const sortParticipants = (list: Array<{ id: string; name: string; sigla_area: string | null }>) => {
    const myTeam = (profile as any)?.sigla_area?.toString().toLowerCase() || "";
    return [...list].sort((a, b) => {
      const aSame = myTeam && (a.sigla_area || "").toLowerCase() === myTeam;
      const bSame = myTeam && (b.sigla_area || "").toLowerCase() === myTeam;
      if (aSame && !bSame) return -1;
      if (!aSame && bSame) return 1;
      return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    });
  };

  useEffect(() => {
    const draft = localStorage.getItem("sepbook_draft");
    if (draft && !content) {
      try {
        const parsed = JSON.parse(draft);
        setContent(parsed.content || "");
      } catch {}
      localStorage.removeItem("sepbook_draft");
    }
  }, [content]);

  const fetchFeed = async () => {
    setFeedLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const resp = await fetch("/api/sepbook-feed", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar feed");
      setPosts(json.items || []);
      if (json?.meta?.warning) {
        console.warn("SEPBook feed warning:", json.meta.warning);
      }
    } catch (e: any) {
      toast({ title: "Erro ao carregar SEPBook", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setFeedLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, []);

  // Campanhas vigentes (para vincular evidências)
  useEffect(() => {
    (async () => {
      try {
        const now = new Date().toISOString();
        const { data, error } = await supabase
          .from("campaigns")
          .select("id, title, start_date, end_date, is_active")
          .eq("is_active", true);
        if (error) {
          console.warn("SEPBook: falha ao carregar campanhas ativas", error.message);
          return;
        }
        const active = (data || []).filter((c: any) => {
          const start = c.start_date || now;
          const end = c.end_date || now;
          return start <= now && end >= now;
        });
        setCampaignOptions(
          active.map((c: any) => ({
            id: c.id,
            title: c.title,
          }))
        );
      } catch (e) {
        console.warn("SEPBook: erro inesperado ao carregar campanhas", e);
      }
    })();
  }, []);

  // Participantes disponíveis (marcar colegas de qualquer equipe)
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, name, sigla_area")
          .order("name")
          .limit(200);
        if (!error && Array.isArray(data)) {
          setParticipantOptions(sortParticipants(data as any));
          // Se ainda não houver seleção, destaca o próprio usuário como participante principal
          if (user?.id) {
            setSelectedParticipants(new Set([user.id]));
          }
        }
      } catch (e) {
        console.warn("SEPBook: falha ao carregar participantes", e);
      }
    })();
  }, []);

  const fetchTrending = async (range: typeof trendRange) => {
    setTrendingLoading(true);
    try {
      const resp = await fetch(`/api/sepbook-trending?range=${encodeURIComponent(range)}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar trending topics");
      const tags = json.tags || [];
      setTrendingTags(tags);
      setTrendingTagsAll(tags);
      setTrendingAI(json.ai?.items || json.ai || null);
    } catch (e: any) {
      toast({
        title: "Erro ao carregar trending topics",
        description: e?.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setTrendingLoading(false);
    }
  };

  useEffect(() => {
    fetchTrending(trendRange);
  }, [trendRange]);

  useEffect(() => {
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) return;
        await fetch("/api/sepbook-mark-seen", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });
        // Notifica a barra de navegação para limpar badges imediatamente
        window.dispatchEvent(new CustomEvent("sepbook-summary-updated"));
      } catch {
        // silencioso
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const q = mentionQuery.trim();
      if (!q || q.length < 1) {
        if (!cancelled) setMentionSuggestions([]);
        return;
      }
      try {
        const resp = await fetch(`/api/sepbook-mention-suggest?q=${encodeURIComponent(q)}`);
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error || "Falha ao sugerir menções");
        if (!cancelled) setMentionSuggestions(json.items || []);
      } catch {
        if (!cancelled) setMentionSuggestions([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mentionQuery]);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/api/sepbook-tags");
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error || "Falha ao carregar tags sugeridas");
        setTagsSuggestions(json.items || []);
      } catch (e) {
        console.warn("SEPBook: falha ao carregar tags de campanhas/desafios");
      }
    })();
  }, []);

  const resolveLocation = () => {
    if (!useLocation) {
      setCoords(null);
      setLocationLabel(null);
      return;
    }
    if (!navigator.geolocation) {
      toast({ title: "Geolocalização indisponível", description: "Seu navegador não suporta localização.", variant: "destructive" });
      setUseLocation(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ lat: latitude, lng: longitude });
        setLocationLabel(`Lat ${latitude.toFixed(4)}, Lng ${longitude.toFixed(4)}`);
      },
      (err) => {
        console.warn("Erro ao obter localização", err);
        toast({ title: "Não foi possível obter localização", description: "Verifique permissões de GPS.", variant: "destructive" });
        setUseLocation(false);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  useEffect(() => {
    if (useLocation && !askedLocationOnce) {
      resolveLocation();
      setAskedLocationOnce(true);
      try {
        localStorage.setItem("sepbook_location_asked", "1");
      } catch {}
    }
  }, [useLocation, askedLocationOnce]);

  const loadComments = async (postId: string) => {
    setLoadingComments((prev) => ({ ...prev, [postId]: true }));
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const resp = await fetch(`/api/sepbook-comments?post_id=${encodeURIComponent(postId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar comentários");
      setCommentsByPost((prev) => ({ ...prev, [postId]: json.items || [] }));
    } catch (e: any) {
      toast({ title: "Erro ao carregar comentários", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setLoadingComments((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const toggleComments = (postId: string) => {
    setOpenComments((prev) => {
      const next = !prev[postId];
      if (next && !commentsByPost[postId]) {
        loadComments(postId);
      }
      return { ...prev, [postId]: next };
    });
  };

  const handleAddComment = async (post: SepPost) => {
    const text = (newComment[post.id] || "").trim();
    if (text.length < 2) return;
    // sugere hashtags para o comentário e agrega automaticamente (sem aprovação) ao conteúdo enviado
    let finalText = text;
    try {
      const resp = await fetch("/api/ai?handler=suggest-hashtags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await resp.json();
      if (resp.ok && Array.isArray(json.hashtags) && json.hashtags.length > 0) {
        const toAdd = json.hashtags.filter((h: string) => !finalText.includes(h));
        if (toAdd.length > 0) {
          finalText = `${finalText}\n${toAdd.join(" ")}`;
        }
      }
    } catch {}
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const resp = await fetch("/api/sepbook-comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ post_id: post.id, content_md: finalText }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Falha ao comentar");
      const comment: SepComment = json.comment;
      setCommentsByPost((prev) => ({
        ...prev,
        [post.id]: [...(prev[post.id] || []), comment],
      }));
      setNewComment((prev) => ({ ...prev, [post.id]: "" }));
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p
        )
      );
    } catch (e: any) {
      toast({ title: "Erro ao comentar", description: e?.message || "Tente novamente", variant: "destructive" });
    }
  };

  const handleCleanupContent = async () => {
    const text = content.trim();
    if (text.length < 3) {
      toast({ title: "Nada para revisar", description: "Digite o texto antes de pedir correção.", variant: "default" });
      return;
    }
    try {
      setCleaning(true);
      const resp = await fetch("/api/ai?handler=cleanup-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Publicação SEPBook", description: text, language: "pt-BR" }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j?.cleaned?.description) {
        throw new Error(j?.error || "Falha na revisão automática");
      }
      setContent(String(j.cleaned.description || text));
      toast({ title: "Texto revisado", description: "Ortografia e pontuação ajustadas, conteúdo preservado." });
    } catch (e: any) {
      toast({ title: "Não foi possível revisar agora", description: e?.message || "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setCleaning(false);
    }
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    // Detecta a última menção digitada e só mostra sugestões se o cursor estiver logo após ela
    const matches = Array.from(value.matchAll(/@([A-Za-z0-9_.-]{2,30})/g));
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      const endIndex = (last.index ?? 0) + last[0].length;
      if (endIndex === value.length) {
        setMentionQuery(last[1] || "");
      } else {
        // Já veio espaço/pontuação depois da menção: não sugerir mais
        setMentionQuery("");
      }
    } else {
      setMentionQuery("");
    }
  };

  const fetchHashtagSuggestions = async (text: string) => {
    if (!text || text.trim().length < 8) return;
    setHashtagLoading(true);
    try {
      const resp = await fetch("/api/ai?handler=suggest-hashtags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await resp.json();
      if (resp.ok && Array.isArray(json.hashtags)) {
        setHashtagSuggestions(json.hashtags);
      }
    } catch (e) {
      console.warn("hashtags IA", e);
    } finally {
      setHashtagLoading(false);
    }
  };

  const handlePublish = async () => {
    const text = content.trim();
    if (!text && attachments.length === 0) {
      toast({ title: "Conteúdo vazio", description: "Escreva algo ou envie uma mídia antes de publicar.", variant: "destructive" });
      return;
    }
    if (attachmentsUploading) {
      toast({ title: "Aguarde o envio das mídias", description: "Estamos concluindo o upload das fotos/vídeos antes de publicar.", variant: "default" });
      return;
    }
    setLoading(true);
    try {
      let finalText = text;
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const participantsToSend = new Set(selectedParticipants);
      if (user?.id) participantsToSend.add(user.id);
      const resp = await fetch("/api/sepbook-post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content_md: finalText,
          attachments,
          location_label: locationLabel,
          location_lat: coords?.lat ?? null,
          location_lng: coords?.lng ?? null,
          campaign_id: selectedCampaignId || null,
          participant_ids: Array.from(participantsToSend),
          // challenge_id pode ser enviado quando vinculado a um desafio específico
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Falha ao publicar no SEPBook");
      setContent("");
      setAttachments([]);
      setSelectedCampaignId("");
      setSelectedParticipants(new Set());
      setUseLocation(false);
      setCoords(null);
      setLocationLabel(null);
      toast({ title: "Publicado no SEPBook" });
      fetchFeed();
    } catch (e: any) {
      toast({ title: "Erro ao publicar", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (post: SepPost) => {
    setEditingId(post.id);
    setEditingText(post.content_md);
    setEditingNewAttachments([]);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
    setEditingNewAttachments([]);
  };

  const handleSaveEdit = async (post: SepPost) => {
    let text = editingText.trim();
    const mergedAttachments = [
      ...(Array.isArray(post.attachments) ? post.attachments : []),
      ...editingNewAttachments,
    ];
    if (!text && mergedAttachments.length === 0) {
      toast({ title: "Conteúdo vazio", description: "Mantenha algum texto ou mídia no post.", variant: "destructive" });
      return;
    }
    try {
      if (!text.includes("#")) {
        try {
          const r = await fetch("/api/ai?handler=suggest-hashtags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const js = await r.json();
          if (r.ok && Array.isArray(js.hashtags) && js.hashtags.length > 0) {
            const toAdd = js.hashtags.filter((h: string) => !text.includes(h));
            if (toAdd.length > 0) text = `${text}\n${toAdd.join(" ")}`;
          }
        } catch {}
      }
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const resp = await fetch("/api/sepbook-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          post_id: post.id,
          content_md: text,
          attachments: mergedAttachments,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Falha ao salvar edição");
      const updated = json.post;
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                content_md: updated.content_md,
                attachments: updated.attachments || [],
              }
            : p
        )
      );
      cancelEdit();
      toast({ title: "Post atualizado" });
    } catch (e: any) {
      toast({ title: "Erro ao salvar edição", description: e?.message || "Tente novamente", variant: "destructive" });
    }
  };

  const toggleLike = async (post: SepPost) => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const resp = await fetch("/api/sepbook-react", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ post_id: post.id, action: post.has_liked ? "unlike" : "like" }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Falha ao registrar reação");
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, has_liked: !post.has_liked, like_count: json.like_count } : p
        )
      );
    } catch (e: any) {
      toast({ title: "Erro na reação", description: e?.message || "Tente novamente", variant: "destructive" });
    }
  };

  const cleanPostWithIA = async (post: SepPost) => {
    setCleaningPostId(post.id);
    try {
      const body = { title: "Publicação SEPBook", description: post.content_md, language: "pt-BR" };
      const resp = await fetch("/api/ai?handler=cleanup-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => ({}));
      const cleaned = json?.cleaned?.description;
      if (!resp.ok || !cleaned) throw new Error(json?.error || "Falha na revisão");

      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const save = await fetch("/api/sepbook-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          post_id: post.id,
          content_md: cleaned,
          attachments: post.attachments || [],
        }),
      });
      const j2 = await save.json().catch(() => ({}));
      if (!save.ok) throw new Error(j2?.error || "Erro ao salvar revisão");

      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, content_md: cleaned } : p))
      );
      toast({ title: "Texto revisado", description: "Ortografia e pontuação ajustadas (sem alterar o conteúdo)." });
    } catch (e: any) {
      toast({ title: "Não foi possível revisar", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setCleaningPostId(null);
    }
  };

  const deletePost = async (post: SepPost) => {
    if (!confirm("Excluir esta publicação do SEPBook?")) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Não autenticado");
      const resp = await fetch("/api/sepbook-moderate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "delete_post", post_id: post.id }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Falha ao excluir publicação");
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      toast({ title: "Publicação removida" });
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e?.message || "Tente novamente", variant: "destructive" });
    }
  };

  return (
    <div className="relative min-h-screen pb-40">
      <ThemedBackground theme="atitude" />
      <div className="container relative mx-auto p-4 md:p-6 max-w-5xl space-y-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-1 text-xs"
            onClick={() => setShowTrending((v) => !v)}
          >
            <Flame className="h-3 w-3 text-amber-500" />
            {showTrending ? "Ocultar Trending Topics" : "Ver Trending Topics"}
          </Button>
        </div>

        {showTrending && (
          <Card className="border border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-amber-500" />
                  <div>
                    <CardTitle className="text-sm">Trending Topics do SEPBook</CardTitle>
                    <CardDescription className="text-xs">
                      Hashtags mais usadas pelos jogadores, com leitura de IA alinhada ao CHAS.
                    </CardDescription>
                  </div>
                </div>
              <div className="flex items-center gap-2 text-[11px] flex-wrap">
                {(
                  [
                    { key: "week", label: "Semana" },
                    { key: "month", label: "Mês" },
                    { key: "quarter", label: "Trimestre" },
                    { key: "semester", label: "Semestre" },
                    { key: "year", label: "Ano" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTrendRange(opt.key)}
                    className={`px-2 py-0.5 rounded-full border text-[11px] ${
                      trendRange === opt.key
                        ? "bg-amber-500 text-black border-amber-400"
                        : "bg-transparent text-amber-100 border-amber-500/40 hover:bg-amber-500/10"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <input
                  type="search"
                  placeholder="Filtrar #"
                  className="bg-black/20 rounded-full px-2 py-1 text-[11px] border border-amber-500/30"
                  onChange={(e) => {
                    const term = e.target.value.toLowerCase();
                    if (!term) {
                      setTrendingTags(trendingTagsAll);
                      return;
                    }
                    setTrendingTags(
                      trendingTagsAll.filter((t) => t.tag?.toLowerCase().includes(term))
                    );
                  }}
                />
              </div>
            </div>
          </CardHeader>
            <CardContent className="space-y-2">
              {trendingLoading ? (
                <p className="text-xs text-muted-foreground">Carregando trending topics...</p>
              ) : !trendingTags.length ? (
                <p className="text-xs text-muted-foreground">
                  Ainda não há hashtags suficientes neste período. Publique no SEPBook usando # para ativar os trending topics.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1">
                    {trendingTags.slice(0, 10).map((t) => (
                      <span
                        key={t.tag}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-50"
                      >
                        #{t.tag}
                        <span className="opacity-70">
                          {t.count}× • {t.likes || 0} ♥
                        </span>
                      </span>
                    ))}
                  </div>
                  {Array.isArray(trendingAI) && trendingAI.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {trendingAI.slice(0, 3).map((item: any, idx: number) => (
                        <p key={idx} className="text-[11px] text-amber-50/90">
                          <span className="font-semibold">
                            #{item.tag || item.label || "tema"}{" "}
                            {item.dimension && `(${item.dimension})`}:
                          </span>{" "}
                          {item.summary}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold tracking-tight text-white">SEPBook</CardTitle>
            <CardDescription className="text-sm text-white/80">
              Rede social interna da DJT para compartilhar momentos, bastidores e aprendizados espontâneos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-white">
            {showComposer ? (
              <>
                <div className="text-xs text-white/85 border border-white/30 rounded-md p-2 flex gap-2 items-start bg-white/5">
                  <MapPin className="h-3.5 w-3.5 mt-0.5" />
                  <span>
                    As publicações podem usar localização aproximada para análises internas da DJT.
                    {askedLocationOnce
                      ? " Você pode ativar ou desativar a localização a qualquer momento."
                      : " Ao ativar localização pela primeira vez, o navegador pode pedir permissão de GPS."}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Você pode digitar ou falar sua publicação. Use a varinha para revisar ortografia e pontuação.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <VoiceRecorderButton
                      onText={(text) =>
                        setContent((prev) =>
                          [prev, text].filter((v) => v && v.trim().length > 0).join("\n\n")
                        )
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={handleCleanupContent}
                      disabled={cleaning}
                      title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                    >
                      <Wand2 className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant={useLocation ? "secondary" : "outline"}
                      className="h-7 w-7"
                      onClick={() => setUseLocation((prev) => !prev)}
                      title={useLocation ? "Desativar localização" : "Ativar localização aproximada"}
                    >
                      <MapPin className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Textarea
                  rows={3}
                  value={content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Compartilhe um aprendizado, uma boa prática ou um registro de bastidor..."
                />
                {campaignOptions.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-white/80">
                      Vincular a uma campanha vigente (opcional)
                    </p>
                    <select
                      value={selectedCampaignId}
                      onChange={(e) => {
                        setSelectedCampaignId(e.target.value);
                        setSelectedParticipants(new Set());
                      }}
                      className="w-full rounded-md border bg-white text-slate-900 px-2 py-1 text-[11px]"
                    >
                      <option value="">Nenhuma campanha selecionada</option>
                      {campaignOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {participantOptions.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-white/80">
                      Marcar participantes (opcional) — quem estava com você na ação
                    </p>
                    <div className="rounded-md border border-white/25 bg-white/8 px-2 py-2 text-[11px] space-y-2">
                      <div className="flex flex-wrap gap-1">
                        {Array.from(selectedParticipants).map((id) => {
                          const p = participantOptions.find((opt) => opt.id === id);
                          if (!p) return null;
                          const isSelf = user?.id === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                if (isSelf) return; // não remove a si mesmo
                                setSelectedParticipants((prev) => {
                                  const next = new Set(prev);
                                  next.delete(p.id);
                                  return next;
                                });
                              }}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                                isSelf
                                  ? "bg-emerald-600/20 border-emerald-400 text-emerald-100"
                                  : "bg-muted border-muted-foreground/40 text-foreground"
                              }`}
                            >
                              <span className="font-medium">
                                {formatName(p.name)}{isSelf ? " (você)" : ""}
                              </span>
                              {!isSelf && <span className="text-xs">×</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="search"
                          value={participantSearch}
                          onChange={(e) => setParticipantSearch(e.target.value)}
                          placeholder="Buscar por nome ou equipe..."
                          className="flex-1 rounded-md border bg-white text-slate-900 px-2 py-1 text-[11px]"
                        />
                      </div>
                      <div className="max-h-32 overflow-y-auto border-t border-border/40 pt-1">
                        {sortParticipants(
                          participantOptions
                          .filter((p) => {
                            const q = participantSearch.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              p.name.toLowerCase().includes(q) ||
                              (p.sigla_area || "").toLowerCase().includes(q)
                            );
                          }))
                          .map((p) => {
                            const isSelected = selectedParticipants.has(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() =>
                                  setSelectedParticipants((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(p.id)) {
                                      if (user?.id === p.id) return next; // não desmarca o próprio usuário
                                      next.delete(p.id);
                                    } else {
                                      next.add(p.id);
                                    }
                                    return next;
                                  })
                                }
                                className={`w-full text-left px-2 py-0.5 rounded-md text-[11px] ${
                                  isSelected ? "bg-primary/20 text-primary-foreground" : "hover:bg-muted"
                                }`}
                              >
                                {p.name} {p.sigla_area ? `(${p.sigla_area})` : ""}
                              </button>
                            );
                          })}
                      </div>
                      <p className="text-[10px] text-white/75">
                        Sua participação já será registrada automaticamente; use esta lista para marcar quem estava com você.
                      </p>
                    </div>
                  </div>
                )}
                <AttachmentUploader
                  onAttachmentsChange={setAttachments}
                  maxFiles={4}
                  maxSizeMB={20}
                  bucket="evidence"
                  pathPrefix="sepbook"
                  acceptMimeTypes={["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"]}
                  maxVideoSeconds={20}
                  onUploadingChange={setAttachmentsUploading}
                />
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowTagPicker((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                      title="Sugerir hashtags de campanhas e desafios"
                    >
                      <Hash className="h-3 w-3" />
                      Tags
                    </button>
                  </div>
                  {showTagPicker && tagsSuggestions.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1 text-[11px]">
                      {tagsSuggestions.map((t) => (
                        <button
                          key={`${t.kind}-${t.tag}`}
                          type="button"
                          onClick={() =>
                            setContent((prev) => {
                              const hash = `#${t.tag}`;
                              if (prev.includes(hash)) return prev;
                              return [prev.trim(), hash].filter(Boolean).join(" ");
                            })
                          }
                          className="px-2 py-0.5 rounded-full border border-muted-foreground/40 bg-background/60 hover:bg-muted"
                        >
                          #{t.tag}
                        </button>
                      ))}
                    </div>
                  )}
                  {hashtagSuggestions.length > 0 && (
                    <div className="flex flex-col items-center gap-1 text-[11px]">
                      <div className="flex flex-wrap justify-center gap-1">
                        {hashtagSuggestions.map((tag, idx) => (
                          <button
                            key={tag + idx}
                            type="button"
                            onClick={() =>
                              setContent((prev) => {
                                if (prev.includes(tag)) return prev;
                                return [prev.trim(), tag].filter(Boolean).join(" ");
                              })
                            }
                            className="px-2 py-0.5 rounded-full border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setHashtagSuggestions([])}
                        className="mt-1 text-[10px] text-amber-100/80 underline underline-offset-2"
                      >
                        Não usar hashtags sugeridas agora
                      </button>
                    </div>
                  )}
                  {mentionSuggestions.length > 0 && mentionQuery.length >= 1 && (
                    <div className="flex flex-wrap justify-center gap-1 text-[11px]">
                      {mentionSuggestions.map((s, idx) => (
                        <button
                          key={`${s.kind}-${s.handle}-${idx}`}
                          type="button"
                          onClick={() =>
                            {
                              setContent((prev) =>
                                {
                                  const re = /@([A-Za-z0-9_.-]{1,30})/g;
                                  const all = Array.from(prev.matchAll(re));
                                  if (!all.length) {
                                    return [prev.trim(), `@${s.handle}`].filter(Boolean).join(" ");
                                  }
                                  const last = all[all.length - 1];
                                  const start = last.index ?? 0;
                                  const before = prev.slice(0, start);
                                  const after = prev.slice(start + last[0].length);
                                  return `${before}@${s.handle}${after}`;
                                }
                              );
                              setMentionQuery("");
                              setMentionSuggestions([]);
                            }
                          }
                          className="px-2 py-0.5 rounded-full border border-muted-foreground/40 bg-background/60 hover:bg-muted"
                        >
                          <span className="font-semibold">
                            {s.label || s.handle}
                          </span>
                          {s.kind === "user" && (
                            <span className="ml-1 opacity-70">@{s.handle}</span>
                          )}
                          {s.kind === "team" && (
                            <span className="ml-1 opacity-70">(equipe @{s.handle})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => fetchHashtagSuggestions(content)}
                      disabled={hashtagLoading || content.trim().length < 8}
                      className="text-[11px]"
                    >
                      {hashtagLoading ? "Gerando #..." : "Sugerir # com IA"}
                    </Button>
                    <Button
                      onClick={handlePublish}
                      disabled={loading}
                      size="sm"
                      className="px-4"
                    >
                      Publicar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowComposer(false)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-6">
                <p className="text-xs text-muted-foreground text-center">
                  Compartilhe bastidores, boas práticas e momentos da sua base no SEPBook.
                </p>
                <Button
                  type="button"
                  size="icon"
                  className="h-12 w-12 rounded-full shadow-lg"
                  aria-label="Nova publicação no SEPBook"
                  onClick={() => setShowComposer(true)}
                >
                  <Plus className="h-6 w-6" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Feed recente</h2>
            <Button size="xs" variant="outline" onClick={fetchFeed} disabled={feedLoading}>
              {feedLoading ? "Atualizando..." : "Atualizar"}
            </Button>
          </div>
          {posts.length === 0 && !feedLoading && (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                Ainda não há publicações no SEPBook. Que tal ser o primeiro a compartilhar algo?
              </CardContent>
            </Card>
          )}
          {posts.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {p.author_avatar && (
                    <img
                      src={p.author_avatar}
                      alt={p.author_name}
                      className="h-7 w-7 rounded-full object-cover border border-border/60"
                    />
                  )}
                  <div>
                    <CardTitle className="text-sm">{formatName(p.author_name)}</CardTitle>
                    <CardDescription className="text-xs">
                      {(p.author_team || "DJT")}{p.author_base ? ` • ${p.author_base}` : ""} •{" "}
                      {new Date(p.created_at).toLocaleString("pt-BR")}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {isLeader && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => cleanPostWithIA(p)}
                      title="Revisar texto com IA (apenas ortografia/pontuação)"
                      disabled={cleaningPostId === p.id}
                    >
                      <Wand2 className="h-4 w-4" />
                    </Button>
                  )}
                  {user?.id === p.user_id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => startEdit(p)}
                      title="Editar publicação"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {(user?.id === p.user_id || isLeader || profile?.tier === "master") && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => deletePost(p)}
                      title="Remover publicação"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {(p.campaign || (p.participants && p.participants.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {p.campaign && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        <span className="font-semibold">Campanha:</span> {p.campaign.title || "Sem título"}
                      </span>
                    )}
                    {p.participants && p.participants.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300">
                        <span className="font-semibold">Participantes:</span>
                        <span className="truncate max-w-[220px]">
                          {p.participants
                            .map((m) => (m.sigla_area ? `[${m.sigla_area}] ${m.name}` : m.name))
                            .join(", ")}
                        </span>
                      </span>
                    )}
                  </div>
                )}
                {editingId === p.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Use a varinha para revisar o texto desta publicação.</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={async () => {
                          const source = editingText.trim();
                          if (source.length < 3) return;
                          try {
                            const resp = await fetch("/api/ai?handler=cleanup-text", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ title: "Publicação SEPBook (edição)", description: source, language: "pt-BR" }),
                            });
                            const j = await resp.json().catch(() => ({}));
                            const cleaned = j?.cleaned?.description;
                            if (!resp.ok || !cleaned) throw new Error(j?.error || "Falha na revisão automática");
                            setEditingText(String(cleaned));
                            toast({ title: "Texto revisado", description: "Ortografia e pontuação ajustadas, conteúdo preservado." });
                          } catch (e: any) {
                            toast({ title: "Não foi possível revisar agora", description: e?.message || "Tente novamente mais tarde.", variant: "destructive" });
                          }
                        }}
                        title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                      >
                        <Wand2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      rows={3}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                    />
                    <AttachmentUploader
                      onAttachmentsChange={setEditingNewAttachments}
                      maxFiles={4}
                      maxSizeMB={20}
                      bucket="evidence"
                      pathPrefix="sepbook"
                      acceptMimeTypes={[
                        "image/jpeg",
                        "image/png",
                        "image/webp",
                        "image/gif",
                        "video/mp4",
                        "video/webm",
                      ]}
                      maxVideoSeconds={20}
                    />
                    {p.attachments && p.attachments.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                        {p.attachments.map((url, idx) => {
                          const lower = url.toLowerCase();
                          const isVideo = lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov');
                          return isVideo ? (
                            <video
                              key={idx}
                              src={url}
                              controls
                              className="w-full h-24 rounded-md border border-border/60 object-cover bg-black"
                            />
                          ) : (
                            <img
                              key={idx}
                              src={url}
                              alt="mídia SEPBook"
                              className="w-full h-24 object-cover rounded-md border border-border/60"
                            />
                          );
                        })}
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={cancelEdit}
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        onClick={() => handleSaveEdit(p)}
                      >
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap">{p.content_md}</p>
                    {p.attachments && p.attachments.length > 0 && (
                      <div className="mt-2 flex justify-center">
                        <AttachmentViewer urls={p.attachments} postId={p.id} />
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1"
                      onClick={() => toggleLike(p)}
                    >
                      <Heart
                        className={`h-4 w-4 ${p.has_liked ? "fill-red-500 text-red-500" : ""}`}
                      />
                      <span>{p.like_count || 0}</span>
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1"
                      onClick={() => toggleComments(p.id)}
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span>{p.comment_count || 0} comentários</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-border/50 hover:bg-accent"
                    onClick={() => {
                      try {
                        const base = window.location.origin;
                        const url = `${base}/sepbook`;
                        const preview = (p.content_md || '').slice(0, 140).replace(/\s+/g, ' ');
                        const text = preview
                          ? `Veja esta publicação no SEPBook (DJT Quest):\n"${preview}..." \n${url}`
                          : `Veja esta publicação no SEPBook (DJT Quest):\n${url}`;
                        const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
                        window.open(waUrl, '_blank', 'noopener,noreferrer');
                      } catch {
                        // silencioso
                      }
                    }}
                    title="Compartilhar esta publicação no WhatsApp"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {openComments[p.id] && (
                  <div className="mt-2 space-y-2 border-t pt-2">
                    {loadingComments[p.id] ? (
                      <p className="text-[11px] text-muted-foreground">Carregando comentários...</p>
                    ) : (commentsByPost[p.id] || []).length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">Seja o primeiro a comentar.</p>
                    ) : (
                      <div className="space-y-1">
                        {(commentsByPost[p.id] || []).map((c) => (
                          <div key={c.id} className="flex items-start gap-1 text-[11px] text-muted-foreground">
                            {c.author_avatar && (
                              <img
                                src={c.author_avatar}
                                alt={c.author_name}
                                className="h-5 w-5 rounded-full object-cover border border-border/60 mt-0.5"
                              />
                            )}
                            <div>
                              <div>
                                <span className="font-semibold">{formatName(c.author_name)}</span>
                                {c.author_team && (
                                  <span className="ml-1 opacity-70">
                                    ({c.author_team}{c.author_base ? ` • ${c.author_base}` : ""})
                                  </span>
                                )}
                              </div>
                              <span className="block">{c.content_md}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        className="flex-1 rounded-md border bg-background px-2 py-1 text-[11px]"
                        placeholder="Escreva um comentário..."
                        value={newComment[p.id] || ""}
                        onChange={(e) =>
                          setNewComment((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        onClick={() => handleAddComment(p)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
                        title="Enviar comentário"
                      >
                        <Send className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      <Navigation />
    </div>
  );
}
