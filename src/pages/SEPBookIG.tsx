import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation as useRouterLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Navigation from "@/components/Navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { buildAbsoluteAppUrl, openWhatsAppShare } from "@/lib/whatsappShare";
import { useTts } from "@/lib/tts";
import { AttachmentViewer } from "@/components/AttachmentViewer";
import {
  Camera,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Share2,
  Volume2,
  X,
} from "lucide-react";

type SepPost = {
  id: string;
  user_id: string;
  author_name: string;
  author_team: string | null;
  author_avatar: string | null;
  author_base?: string | null;
  content_md: string;
  attachments: string[];
  like_count: number;
  comment_count: number;
  created_at: string;
  location_label?: string | null;
  has_liked: boolean;
};

type SepComment = {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string;
  author_team: string | null;
  author_avatar?: string | null;
  content_md: string;
  attachments?: string[];
  created_at: string;
};

type LikeUser = {
  user_id: string;
  name: string;
  sigla_area: string | null;
  avatar_url: string | null;
  operational_base: string | null;
  created_at: string;
};

type MentionSuggestion = {
  kind: "team" | "user" | string;
  handle: string;
  label: string;
  base?: string | null;
};

type MediaItem = {
  id: string;
  file: File;
  kind: "image" | "video";
  previewUrl?: string;
  uploading: boolean;
  progress: number;
  url?: string;
  bucket?: string;
  filePath?: string;
  error?: string;
};

const randomId = () => Math.random().toString(36).slice(2);

const getExtFromType = (mime: string) => {
  const t = String(mime || "").toLowerCase();
  if (t === "image/jpeg") return "jpg";
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/gif") return "gif";
  if (t === "video/mp4") return "mp4";
  if (t === "video/webm") return "webm";
  if (t === "video/quicktime") return "mov";
  return "bin";
};

const formatName = (name: string | null | undefined) => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 1) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

const initials = (name: string | null | undefined) => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const detectMentionQuery = (text: string) => {
  const v = String(text || "");
  const m = v.match(/@([A-Za-z0-9_.-]{1,40})$/);
  return m?.[1] || "";
};

const applyMention = (text: string, query: string, handle: string) => {
  const q = String(query || "").trim();
  const h = String(handle || "").trim();
  if (!q || !h) return text;
  const suffix = `@${q}`;
  if (!text.endsWith(suffix)) return text;
  return `${text.slice(0, text.length - suffix.length)}@${h} `;
};

const copyToClipboard = async (toast: ReturnType<typeof useToast>["toast"], value: string) => {
  const v = String(value || "").trim();
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v);
    toast({ title: "Copiado", description: v });
  } catch {
    toast({ title: "Não foi possível copiar", description: v, variant: "destructive" });
  }
};

const renderRichText = (toast: ReturnType<typeof useToast>["toast"], text: string) => {
  const src = String(text || "");
  const lines = src.split("\n");
  const re = /(@[A-Za-z0-9_.-]+|#[\\p{L}0-9_]+)/gu;
  return (
    <span className="whitespace-pre-wrap">
      {lines.map((line, lineIdx) => {
        const parts: any[] = [];
        let last = 0;
        for (const m of line.matchAll(re)) {
          const idx = m.index ?? 0;
          const token = String(m[0] || "");
          if (idx > last) parts.push(line.slice(last, idx));
          parts.push(
            <button
              key={`${lineIdx}-${idx}-${token}`}
              type="button"
              className="text-primary hover:underline"
              onClick={() => void copyToClipboard(toast, token)}
              title="Clique para copiar"
            >
              {token}
            </button>,
          );
          last = idx + token.length;
        }
        if (last < line.length) parts.push(line.slice(last));
        return (
          <span key={`line-${lineIdx}`}>
            {parts}
            {lineIdx < lines.length - 1 ? "\n" : ""}
          </span>
        );
      })}
    </span>
  );
};

const maybeDownscaleImage = async (file: File, maxImageDimension: number, imageQuality: number): Promise<File> => {
  if (typeof document === "undefined") return file;
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file; // keep animated GIFs

  const MAX_DIM = Math.max(256, Math.floor(Number(maxImageDimension) || 1920));
  const QUALITY = Math.max(0.1, Math.min(1, Number(imageQuality) || 0.82));

  return await new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          try {
            URL.revokeObjectURL(img.src);
          } catch {
            /* ignore */
          }
          let { width, height } = img;
          if (width <= MAX_DIM && height <= MAX_DIM) {
            resolve(file);
            return;
          }
          const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(file);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(file);
                return;
              }
              const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
              const newFile = new File([blob], `${baseName}-${MAX_DIM}p.jpg`, { type: "image/jpeg" });
              resolve(newFile);
            },
            "image/jpeg",
            QUALITY,
          );
        } catch {
          resolve(file);
        }
      };
      img.onerror = () => {
        try {
          URL.revokeObjectURL(img.src);
        } catch {
          /* ignore */
        }
        resolve(file);
      };
      img.src = URL.createObjectURL(file);
    } catch {
      resolve(file);
    }
  });
};

async function uploadToBucket(params: {
  bucket: string;
  pathPrefix: string;
  file: File;
  maxImageDimension: number;
  imageQuality: number;
}) {
  const { bucket, pathPrefix } = params;
  let { file } = params;
  file = await maybeDownscaleImage(file, params.maxImageDimension, params.imageQuality);

  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) throw new Error("Usuário não autenticado");

  const extFromName = file.name.includes(".") ? file.name.split(".").pop() : null;
  const fileExt = (extFromName && String(extFromName).trim()) || getExtFromType(file.type);
  const fileName = `${Date.now()}-${randomId()}.${fileExt}`;
  const prefix = pathPrefix ? `${pathPrefix.replace(/\/+$/, "")}/` : "";
  const filePath = `${prefix}${user.id}/${fileName}`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(filePath);
  const publicUrl = publicData?.publicUrl;
  if (!publicUrl) throw new Error("Falha ao obter URL pública do arquivo");

  return { publicUrl, filePath };
}

function useMentionSuggest(query: string) {
  const [items, setItems] = useState<MentionSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = String(query || "").trim();
    if (q.length < 1) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      (async () => {
        setLoading(true);
        try {
          const resp = await apiFetch(`/api/sepbook-mention-suggest?q=${encodeURIComponent(q)}`);
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(json?.error || "Falha ao sugerir menções");
          if (!cancelled) setItems(Array.isArray(json.items) ? (json.items as any) : []);
        } catch {
          if (!cancelled) setItems([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  return { items, loading };
}

export default function SEPBookIG() {
  const { toast } = useToast();
  const routerLocation = useRouterLocation();
  const { speak, isSpeaking } = useTts();

  const [posts, setPosts] = useState<SepPost[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedWarning, setFeedWarning] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [composerMentionQuery, setComposerMentionQuery] = useState("");
  const composerMentions = useMentionSuggest(composerMentionQuery);
  const [composerMedia, setComposerMedia] = useState<MediaItem[]>([]);
  const [composerUploading, setComposerUploading] = useState(false);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const composerCameraRef = useRef<HTMLInputElement | null>(null);
  const composerGalleryRef = useRef<HTMLInputElement | null>(null);

  const [commentsOpenFor, setCommentsOpenFor] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, SepComment[]>>({});
  const [commentsLoading, setCommentsLoading] = useState<Record<string, boolean>>({});
  const [commentText, setCommentText] = useState("");
  const [commentMentionQuery, setCommentMentionQuery] = useState("");
  const commentMentions = useMentionSuggest(commentMentionQuery);
  const [commentMedia, setCommentMedia] = useState<MediaItem[]>([]);
  const [commentUploading, setCommentUploading] = useState(false);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const commentCameraRef = useRef<HTMLInputElement | null>(null);
  const commentGalleryRef = useRef<HTMLInputElement | null>(null);

  const [likesOpenFor, setLikesOpenFor] = useState<string | null>(null);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likers, setLikers] = useState<LikeUser[]>([]);

  const deepLinkCommentTargetRef = useRef<{ commentId: string; postId: string } | null>(null);
  const deepLinkCommentHandledRef = useRef<string | null>(null);

  const activePost = useMemo(() => posts.find((p) => p.id === commentsOpenFor) || null, [commentsOpenFor, posts]);

  const uploadedComposerUrls = useMemo(
    () => composerMedia.filter((m) => m.url).map((m) => m.url!) as string[],
    [composerMedia],
  );
  const uploadedCommentUrls = useMemo(
    () => commentMedia.filter((m) => m.url).map((m) => m.url!) as string[],
    [commentMedia],
  );

  const speakText = useCallback(
    async (text: string) => {
      const v = String(text || "").trim();
      if (!v) return;
      try {
        await speak(v);
      } catch (e: any) {
        toast({ title: "Não foi possível tocar o áudio", description: e?.message || "Tente novamente", variant: "destructive" });
      }
    },
    [speak, toast],
  );

  const loadFeed = useCallback(async () => {
    setLoadingFeed(true);
    setFeedWarning(null);
    try {
      const resp = await apiFetch("/api/sepbook-feed");
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar feed");
      const items = Array.isArray(json.items) ? (json.items as any) : [];
      setPosts(items);
      const warning = json?.meta?.warning ? String(json.meta.warning) : null;
      setFeedWarning(warning);
    } catch (e: any) {
      toast({ title: "SEPBook", description: e?.message || "Falha ao carregar", variant: "destructive" });
    } finally {
      setLoadingFeed(false);
    }
  }, [toast]);

  const loadComments = useCallback(
    async (postId: string) => {
      const id = String(postId || "").trim();
      if (!id) return;
      setCommentsLoading((prev) => ({ ...prev, [id]: true }));
      try {
        const resp = await apiFetch(`/api/sepbook-comments?post_id=${encodeURIComponent(id)}`);
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao carregar comentários");
        setCommentsByPost((prev) => ({ ...prev, [id]: Array.isArray(json.items) ? (json.items as any) : [] }));
      } catch (e: any) {
        toast({ title: "Comentários", description: e?.message || "Falha ao carregar", variant: "destructive" });
      } finally {
        setCommentsLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [toast],
  );

  const openComments = useCallback(
    async (postId: string) => {
      const id = String(postId || "").trim();
      if (!id) return;
      setCommentsOpenFor(id);
      setCommentText("");
      setCommentMentionQuery("");
      commentMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
      setCommentMedia([]);
      if (!commentsByPost[id]) await loadComments(id);
    },
    [commentMedia, commentsByPost, loadComments],
  );

  const toggleLike = useCallback(
    async (post: SepPost) => {
      const id = String(post?.id || "").trim();
      if (!id) return;
      const wasLiked = Boolean(post.has_liked);
      const nextLiked = !wasLiked;
      setPosts((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, has_liked: nextLiked, like_count: Math.max(0, (p.like_count || 0) + (nextLiked ? 1 : -1)) }
            : p,
        ),
      );
      try {
        const resp = await apiFetch("/api/sepbook-react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ post_id: id, action: nextLiked ? "like" : "unlike" }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao reagir");
        const nextCount = typeof json.like_count === "number" ? json.like_count : undefined;
        if (typeof nextCount === "number") {
          setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, like_count: nextCount } : p)));
        }
      } catch (e: any) {
        // rollback
        setPosts((prev) =>
          prev.map((p) =>
            p.id === id
              ? { ...p, has_liked: wasLiked, like_count: Math.max(0, (p.like_count || 0) + (wasLiked ? 1 : -1)) }
              : p,
          ),
        );
        toast({ title: "Curtida", description: e?.message || "Não foi possível reagir", variant: "destructive" });
      }
    },
    [toast],
  );

  const openLikes = useCallback(
    async (postId: string) => {
      const id = String(postId || "").trim();
      if (!id) return;
      setLikesOpenFor(id);
      setLikesLoading(true);
      setLikers([]);
      try {
        const resp = await apiFetch(`/api/sepbook-likes?post_id=${encodeURIComponent(id)}`);
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao carregar curtidas");
        setLikers(Array.isArray(json.items) ? (json.items as any) : []);
      } catch (e: any) {
        toast({ title: "Curtidas", description: e?.message || "Falha ao carregar", variant: "destructive" });
      } finally {
        setLikesLoading(false);
      }
    },
    [toast],
  );

  const sharePost = useCallback((post: SepPost) => {
    const url = buildAbsoluteAppUrl(`/sepbook#post-${encodeURIComponent(post.id)}`);
    const preview = (post.content_md || "").trim().replace(/\s+/g, " ").slice(0, 140);
    openWhatsAppShare({
      message: preview
        ? `Veja esta publicação no SEPBook (DJT Quest):\n"${preview}${preview.length >= 140 ? "…" : ""}"`
        : "Veja esta publicação no SEPBook (DJT Quest):",
      url,
    });
  }, []);

  const shareComment = useCallback((postId: string, comment: SepComment) => {
    const url = buildAbsoluteAppUrl(`/sepbook?comment=${encodeURIComponent(comment.id)}#post-${encodeURIComponent(postId)}`);
    const preview = (comment.content_md || "").trim().replace(/\s+/g, " ").slice(0, 140);
    openWhatsAppShare({
      message: preview
        ? `Comentário no SEPBook (DJT Quest):\n"${preview}${preview.length >= 140 ? "…" : ""}"`
        : "Comentário no SEPBook (DJT Quest):",
      url,
    });
  }, []);

  const removeMediaItem = useCallback(async (item: MediaItem, setState: (updater: any) => void) => {
    if (item.previewUrl) {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch {
        /* ignore */
      }
    }
    setState((prev: MediaItem[]) => prev.filter((m) => m.id !== item.id));
    if (item.bucket && item.filePath) {
      try {
        await supabase.storage.from(item.bucket).remove([item.filePath]);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const addMediaFiles = useCallback(
    async (opts: {
      files: FileList | null;
      context: "post" | "comment";
      source: "camera" | "gallery";
    }) => {
      const list = opts.files ? Array.from(opts.files) : [];
      if (!list.length) return;

      const isPost = opts.context === "post";
      const maxFiles = isPost ? 4 : 3;
      const maxImages = isPost ? 3 : 3;
      const maxVideos = isPost ? 1 : 0;
      const maxSizeMB = isPost ? 50 : 20;
      const bucket = "evidence";
      const pathPrefix = isPost ? "sepbook" : "sepbook-comments";
      const maxImageDimension = isPost ? 3840 : 1920;
      const imageQuality = 0.82;

      const allowed = new Set<string>([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        ...(isPost ? ["video/mp4", "video/webm", "video/quicktime"] : []),
      ]);

      const setState = isPost ? setComposerMedia : setCommentMedia;
      const current = isPost ? composerMedia : commentMedia;
      const setUploading = isPost ? setComposerUploading : setCommentUploading;

      let imagesCount = current.filter((m) => m.kind === "image").length;
      let videosCount = current.filter((m) => m.kind === "video").length;
      let totalCount = current.length;

      setUploading(true);
      for (const file of list) {
        if (totalCount >= maxFiles) {
          toast({ title: "Limite atingido", description: `Máximo de ${maxFiles} arquivo(s).` });
          break;
        }
        if (!allowed.has(file.type)) {
          toast({ title: "Arquivo não suportado", description: file.type || file.name, variant: "destructive" });
          continue;
        }
        const sizeMB = file.size / 1024 / 1024;
        if (sizeMB > maxSizeMB) {
          toast({ title: "Arquivo muito grande", description: `${sizeMB.toFixed(1)}MB (máx: ${maxSizeMB}MB)`, variant: "destructive" });
          continue;
        }

        const kind: MediaItem["kind"] = file.type.startsWith("video/") ? "video" : "image";
        if (kind === "image" && imagesCount >= maxImages) {
          toast({ title: "Limite de fotos", description: `Máximo de ${maxImages} foto(s).` });
          continue;
        }
        if (kind === "video" && videosCount >= maxVideos) {
          toast({ title: "Limite de vídeo", description: `Máximo de ${maxVideos} vídeo(s).` });
          continue;
        }

        const id = randomId();
        const previewUrl = URL.createObjectURL(file);
        const item: MediaItem = { id, file, kind, previewUrl, uploading: true, progress: 30 };
        setState((prev: MediaItem[]) => [...prev, item]);

        try {
          const { publicUrl, filePath } = await uploadToBucket({
            bucket,
            pathPrefix,
            file,
            maxImageDimension,
            imageQuality,
          });
          setState((prev: MediaItem[]) =>
            prev.map((m) => (m.id === id ? { ...m, uploading: false, progress: 100, url: publicUrl, bucket, filePath } : m)),
          );
        } catch (e: any) {
          setState((prev: MediaItem[]) =>
            prev.map((m) => (m.id === id ? { ...m, uploading: false, progress: 0, error: e?.message || "Erro no upload" } : m)),
          );
          toast({ title: "Upload", description: e?.message || "Erro ao subir arquivo", variant: "destructive" });
        }

        totalCount += 1;
        if (kind === "image") imagesCount += 1;
        if (kind === "video") videosCount += 1;
      }
      setUploading(false);

      // reset input so the same file can be picked again
      try {
        if (opts.context === "post") {
          if (opts.source === "camera" && composerCameraRef.current) composerCameraRef.current.value = "";
          if (opts.source === "gallery" && composerGalleryRef.current) composerGalleryRef.current.value = "";
        } else {
          if (opts.source === "camera" && commentCameraRef.current) commentCameraRef.current.value = "";
          if (opts.source === "gallery" && commentGalleryRef.current) commentGalleryRef.current.value = "";
        }
      } catch {
        /* ignore */
      }
    },
    [commentMedia, composerMedia, toast],
  );

  const submitPost = useCallback(async () => {
    const text = String(composerText || "").trim();
    const uploading = composerUploading || composerMedia.some((m) => m.uploading);
    if (uploading) {
      toast({ title: "Aguarde o upload", description: "Estamos concluindo o envio das mídias." });
      return;
    }
    if (!text && uploadedComposerUrls.length === 0) return;
    try {
      setComposerSubmitting(true);
      const resp = await apiFetch("/api/sepbook-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_md: text, attachments: uploadedComposerUrls }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao postar");
      const post = json?.post as SepPost | undefined;
      if (post?.id) setPosts((prev) => [post, ...prev]);
      setComposerOpen(false);
      setComposerText("");
      setComposerMentionQuery("");
      composerMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
      setComposerMedia([]);
      toast({ title: "Publicado", description: "Sua postagem foi publicada no SEPBook." });
    } catch (e: any) {
      toast({ title: "Publicação", description: e?.message || "Falha ao publicar", variant: "destructive" });
    } finally {
      setComposerSubmitting(false);
    }
  }, [composerMedia, composerText, composerUploading, toast, uploadedComposerUrls]);

  const submitComment = useCallback(async () => {
    const postId = String(commentsOpenFor || "").trim();
    if (!postId) return;
    const text = String(commentText || "").trim();
    const uploading = commentUploading || commentMedia.some((m) => m.uploading);
    if (uploading) {
      toast({ title: "Aguarde o upload", description: "Estamos concluindo o envio das fotos." });
      return;
    }
    if (text.length < 2 && uploadedCommentUrls.length === 0) return;
    try {
      setCommentSubmitting(true);
      const resp = await apiFetch("/api/sepbook-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: postId, content_md: text, attachments: uploadedCommentUrls }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao comentar");
      const c = json?.comment as SepComment | undefined;
      if (c?.id) {
        setCommentsByPost((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), c] }));
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p)));
      }
      setCommentText("");
      setCommentMentionQuery("");
      commentMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
      setCommentMedia([]);
    } catch (e: any) {
      toast({ title: "Comentário", description: e?.message || "Falha ao comentar", variant: "destructive" });
    } finally {
      setCommentSubmitting(false);
    }
  }, [commentMedia, commentText, commentUploading, commentsOpenFor, toast, uploadedCommentUrls]);

  // Mark seen on entry (best-effort) and clear nav badges
  useEffect(() => {
    (async () => {
      try {
        await apiFetch("/api/sepbook-mark-seen", { method: "POST", headers: { "Content-Type": "application/json" } });
        window.dispatchEvent(new CustomEvent("sepbook-summary-updated"));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    const hashId = (routerLocation.hash || "").replace(/^#/, "").trim();
    if (!hashId) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(hashId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [routerLocation.hash, posts.length]);

  // Deep link: ?comment=<id> -> open drawer for the post and scroll to the comment
  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search || "");
    const commentId = (params.get("comment") || "").trim();
    if (!commentId) {
      deepLinkCommentHandledRef.current = null;
      deepLinkCommentTargetRef.current = null;
      return;
    }
    if (deepLinkCommentHandledRef.current === commentId) return;
    deepLinkCommentHandledRef.current = commentId;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("sepbook_comments")
          .select("post_id")
          .eq("id", commentId)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        const postId = (data as any)?.post_id as string | undefined;
        if (!postId) return;

        deepLinkCommentTargetRef.current = { commentId, postId };
        await openComments(postId);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openComments, routerLocation.search]);

  useEffect(() => {
    const target = deepLinkCommentTargetRef.current;
    if (!target) return;
    if (commentsOpenFor !== target.postId) return;
    if (!commentsByPost[target.postId]) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`comment-${target.commentId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        deepLinkCommentTargetRef.current = null;
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [commentsByPost, commentsOpenFor]);

  // Track mention queries for post/comment inputs
  useEffect(() => {
    setComposerMentionQuery(detectMentionQuery(composerText));
  }, [composerText]);
  useEffect(() => {
    setCommentMentionQuery(detectMentionQuery(commentText));
  }, [commentText]);

  const renderMediaThumbs = (items: MediaItem[], onRemove: (item: MediaItem) => void) => {
    if (!items.length) return null;
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((m) => (
          <div key={m.id} className="relative h-16 w-16 rounded-lg border bg-muted overflow-hidden">
            {m.kind === "image" ? (
              <img
                src={m.url || m.previewUrl}
                alt="Anexo"
                className={cn("h-full w-full object-cover", m.uploading && "opacity-60")}
              />
            ) : (
              <video
                src={m.url || m.previewUrl}
                className={cn("h-full w-full object-cover", m.uploading && "opacity-60")}
                muted
                playsInline
              />
            )}
            {m.uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <span className="text-[11px] text-white tabular-nums">{m.progress}%</span>
              </div>
            )}
            <button
              type="button"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background shadow flex items-center justify-center border"
              onClick={() => void onRemove(m)}
              aria-label="Remover"
              title="Remover"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-[120px]">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[680px] items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[12px] text-muted-foreground leading-tight">SEPBook</p>
            <h1 className="text-[16px] font-black leading-tight tracking-tight truncate">Feed</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="ghost" onClick={() => setComposerOpen(true)} aria-label="Nova postagem">
              <Plus className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[680px]">
        {feedWarning && (
          <div className="mx-3 mt-3 rounded-xl border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            {feedWarning}
          </div>
        )}
        {loadingFeed ? (
          <div className="px-4 py-10 text-sm text-muted-foreground">Carregando...</div>
        ) : posts.length === 0 ? (
          <div className="px-4 py-10 text-sm text-muted-foreground">Nenhuma publicação ainda.</div>
        ) : (
          <div className="flex flex-col">
            {posts.map((p) => {
              const createdLabel = new Date(p.created_at).toLocaleString();
              const caption = String(p.content_md || "").trim();
              return (
                <article key={p.id} id={`post-${p.id}`} className="border-b">
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={p.author_avatar || undefined} alt={p.author_name || "Autor"} />
                        <AvatarFallback>{initials(p.author_name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-semibold truncate">{formatName(p.author_name)}</span>
                          {p.author_team ? (
                            <span className="text-[12px] text-muted-foreground truncate">{p.author_team}</span>
                          ) : null}
                        </div>
                        {p.location_label ? (
                          <span className="text-[11px] text-muted-foreground truncate">{p.location_label}</span>
                        ) : null}
                      </div>
                    </div>

                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        void copyToClipboard(toast, buildAbsoluteAppUrl(`/sepbook#post-${encodeURIComponent(p.id)}`));
                      }}
                      aria-label="Opções"
                      title="Copiar link"
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </Button>
                  </div>

                  {Array.isArray(p.attachments) && p.attachments.length > 0 ? (
                    <div className="px-0">
                      <AttachmentViewer
                        urls={p.attachments}
                        postId={p.id}
                        mediaLayout="carousel"
                        className="mt-0 space-y-0"
                        enableLightbox={false}
                        showMetadata={false}
                        onMediaDoubleClick={() => {
                          if (!p.has_liked) void toggleLike(p);
                        }}
                      />
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between px-2 pt-1">
                    <div className="flex items-center gap-0.5">
                      <Button type="button" size="icon" variant="ghost" onClick={() => void toggleLike(p)} aria-label="Curtir">
                        <Heart className={cn("h-6 w-6", p.has_liked && "fill-rose-500 text-rose-500")} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => void openComments(p.id)}
                        aria-label="Comentar"
                      >
                        <MessageCircle className="h-6 w-6" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" onClick={() => sharePost(p)} aria-label="Compartilhar">
                        <Send className="h-6 w-6" />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void speakText(p.content_md)}
                      aria-label="Ouvir"
                      title="Ouvir"
                      disabled={isSpeaking || !caption}
                    >
                      <Volume2 className="h-5 w-5" />
                    </Button>
                  </div>

                  <div className="px-3 pb-3 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => void openLikes(p.id)}
                      className="text-[13px] font-semibold"
                      aria-label="Ver curtidas"
                    >
                      {p.like_count || 0} curtida{(p.like_count || 0) === 1 ? "" : "s"}
                    </button>

                    {caption ? (
                      <div className="text-[13px]">
                        <span className="font-semibold">{formatName(p.author_name)}</span>{" "}
                        {renderRichText(toast, caption)}
                      </div>
                    ) : null}

                    {p.comment_count > 0 ? (
                      <button
                        type="button"
                        className="text-[13px] text-muted-foreground"
                        onClick={() => void openComments(p.id)}
                      >
                        Ver todos os {p.comment_count} comentário{p.comment_count === 1 ? "" : "s"}
                      </button>
                    ) : (
                      <button type="button" className="text-[13px] text-muted-foreground" onClick={() => void openComments(p.id)}>
                        Adicionar comentário
                      </button>
                    )}

                    <div className="text-[11px] text-muted-foreground">{createdLabel}</div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <Navigation />

      <Drawer
        open={composerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setComposerOpen(false);
            setComposerText("");
            setComposerMentionQuery("");
            composerMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
            setComposerMedia([]);
            setComposerUploading(false);
            setComposerSubmitting(false);
          } else {
            setComposerOpen(true);
          }
        }}
      >
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader>
            <DrawerTitle>Nova publicação</DrawerTitle>
          </DrawerHeader>

          <div className="px-3 pb-3 space-y-3">
            {renderMediaThumbs(composerMedia, (m) => removeMediaItem(m, setComposerMedia))}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => composerCameraRef.current?.click()}
                disabled={composerUploading || composerSubmitting}
                aria-label="Câmera"
                title="Câmera"
              >
                <Camera className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => composerGalleryRef.current?.click()}
                disabled={composerUploading || composerSubmitting}
                aria-label="Fototeca"
                title="Fototeca"
              >
                <ImageIcon className="h-4 w-4" />
              </Button>

              <input
                ref={composerCameraRef}
                type="file"
                accept="image/*,video/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void addMediaFiles({ files: e.target.files, context: "post", source: "camera" })}
              />
              <input
                ref={composerGalleryRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => void addMediaFiles({ files: e.target.files, context: "post", source: "gallery" })}
              />

              <div className="flex-1" />

              <Button
                type="button"
                onClick={() => void submitPost()}
                disabled={composerSubmitting || composerUploading || composerMedia.some((m) => m.uploading) || (!composerText.trim() && uploadedComposerUrls.length === 0)}
              >
                Publicar
              </Button>
            </div>

            <Textarea
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              placeholder="Escreva uma legenda…"
              className="min-h-[120px]"
            />

            {composerMentionQuery && composerMentions.items.length > 0 && (
              <div className="rounded-xl border bg-background">
                <div className="px-3 py-2 text-[12px] text-muted-foreground">Sugestões de @menção</div>
                <div className="max-h-[220px] overflow-auto">
                  {composerMentions.items.slice(0, 12).map((s, idx) => (
                    <button
                      key={`${s.kind}-${s.handle}-${idx}`}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-muted text-[13px]"
                      onClick={() => setComposerText((prev) => applyMention(prev, composerMentionQuery, s.handle))}
                    >
                      <span className="font-semibold">@{s.handle}</span>{" "}
                      <span className="text-muted-foreground">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={Boolean(commentsOpenFor)}
        onOpenChange={(open) => {
          if (!open) {
            setCommentsOpenFor(null);
            setCommentText("");
            setCommentMentionQuery("");
            commentMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
            setCommentMedia([]);
            setCommentUploading(false);
            setCommentSubmitting(false);
          }
        }}
      >
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader>
            <DrawerTitle>{activePost ? `Comentários • ${formatName(activePost.author_name)}` : "Comentários"}</DrawerTitle>
          </DrawerHeader>

          <div className="flex flex-col h-full">
            <ScrollArea className="flex-1 px-3 pb-3">
              {activePost && (
                <div className="mb-3 rounded-xl border bg-muted/20 px-3 py-2">
                  <div className="text-[12px] text-muted-foreground">
                    {formatName(activePost.author_name)} {activePost.author_team ? `• ${activePost.author_team}` : ""}
                  </div>
                  {String(activePost.content_md || "").trim() ? (
                    <div className="text-[13px] mt-1">{renderRichText(toast, activePost.content_md)}</div>
                  ) : null}
                </div>
              )}

              {commentsOpenFor && commentsLoading[commentsOpenFor] ? (
                <div className="py-6 text-sm text-muted-foreground">Carregando comentários...</div>
              ) : commentsOpenFor && (commentsByPost[commentsOpenFor] || []).length === 0 ? (
                <div className="py-6 text-sm text-muted-foreground">Seja o primeiro a comentar.</div>
              ) : (
                <div className="space-y-3">
                  {(commentsOpenFor ? commentsByPost[commentsOpenFor] || [] : []).map((c) => {
                    const text = String(c.content_md || "").trim();
                    const hasAtt = Array.isArray(c.attachments) && c.attachments.length > 0;
                    return (
                      <div key={c.id} id={`comment-${c.id}`} className="flex items-start gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={c.author_avatar || undefined} alt={c.author_name || "Autor"} />
                          <AvatarFallback>{initials(c.author_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-[13px] font-semibold">{formatName(c.author_name)}</span>{" "}
                              {c.author_team ? <span className="text-[12px] text-muted-foreground">{c.author_team}</span> : null}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => void speakText(text)}
                                disabled={isSpeaking || !text}
                                aria-label="Ouvir comentário"
                                title="Ouvir"
                              >
                                <Volume2 className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => commentsOpenFor && shareComment(commentsOpenFor, c)}
                                aria-label="Compartilhar comentário"
                                title="Compartilhar"
                              >
                                <Share2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {text ? <div className="text-[13px] mt-0.5">{renderRichText(toast, text)}</div> : null}
                          {hasAtt ? (
                            <AttachmentViewer urls={c.attachments || []} postId={c.post_id} mediaLayout="grid" />
                          ) : null}
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {new Date(c.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            <div className="border-t bg-background px-3 py-3 space-y-2">
              {renderMediaThumbs(commentMedia, (m) => removeMediaItem(m, setCommentMedia))}

              {commentMentionQuery && commentMentions.items.length > 0 && (
                <div className="rounded-xl border bg-background">
                  <div className="px-3 py-2 text-[12px] text-muted-foreground">Sugestões de @menção</div>
                  <div className="max-h-[160px] overflow-auto">
                    {commentMentions.items.slice(0, 8).map((s, idx) => (
                      <button
                        key={`${s.kind}-${s.handle}-${idx}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted text-[13px]"
                        onClick={() => setCommentText((prev) => applyMention(prev, commentMentionQuery, s.handle))}
                      >
                        <span className="font-semibold">@{s.handle}</span>{" "}
                        <span className="text-muted-foreground">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => commentCameraRef.current?.click()}
                  disabled={commentUploading || commentSubmitting}
                  aria-label="Câmera"
                  title="Câmera"
                >
                  <Camera className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => commentGalleryRef.current?.click()}
                  disabled={commentUploading || commentSubmitting}
                  aria-label="Fototeca"
                  title="Fototeca"
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
                <input
                  ref={commentCameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void addMediaFiles({ files: e.target.files, context: "comment", source: "camera" })}
                />
                <input
                  ref={commentGalleryRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void addMediaFiles({ files: e.target.files, context: "comment", source: "gallery" })}
                />

                <Textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Adicionar um comentário…"
                  rows={1}
                  className="min-h-[42px] max-h-[120px] resize-none"
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void submitComment()}
                  disabled={
                    commentSubmitting ||
                    commentUploading ||
                    commentMedia.some((m) => m.uploading) ||
                    ((commentText.trim().length < 2) && uploadedCommentUrls.length === 0)
                  }
                  aria-label="Enviar comentário"
                  title="Enviar"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Fotos: até 3 por comentário • Use <span className="font-semibold">📷</span> para câmera e{" "}
                <span className="font-semibold">🖼️</span> para fototeca.
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={Boolean(likesOpenFor)} onOpenChange={(open) => !open && setLikesOpenFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Curtidas</DialogTitle>
          </DialogHeader>
          {likesLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Carregando...</div>
          ) : likers.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">Ninguém curtiu ainda.</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto space-y-2 pr-1">
              {likers.map((u) => (
                <div key={u.user_id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={u.avatar_url || undefined} alt={u.name || "Usuário"} />
                    <AvatarFallback>{initials(u.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">{formatName(u.name)}</div>
                    <div className="text-[12px] text-muted-foreground truncate">
                      {(u.sigla_area || "DJT") + (u.operational_base ? ` • ${u.operational_base}` : "")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
