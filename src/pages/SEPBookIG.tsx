import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation as useRouterLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Navigation from "@/components/Navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { buildAbsoluteAppUrl, openWhatsAppShare } from "@/lib/whatsappShare";
import { useTts } from "@/lib/tts";
import { AttachmentViewer } from "@/components/AttachmentViewer";
import { VoiceRecorderButton } from "@/components/VoiceRecorderButton";
import { UserProfilePopover } from "@/components/UserProfilePopover";
import { SendUserFeedbackDialog } from "@/components/SendUserFeedbackDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { translateTextsCached } from "@/lib/i18n/aiTranslate";
import { localeToOpenAiLanguageTag } from "@/lib/i18n/language";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import {
  AtSign,
  Camera,
  Check,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  MapPinned,
  MoreHorizontal,
  Pencil,
  Plus,
  Reply,
  Send,
  Share2,
  SlidersHorizontal,
  Trash2,
  Volume2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
});

type SepPost = {
  id: string;
  user_id: string;
  author_name: string;
  author_team: string | null;
  author_avatar: string | null;
  author_base?: string | null;
  content_md: string;
  translations?: Record<string, string> | null;
  attachments: string[];
  like_count: number;
  comment_count: number;
  created_at: string;
  location_label?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  campaign_id?: string | null;
  campaign?: { id: string; title: string | null; is_active?: boolean } | null;
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
  translations?: Record<string, string> | null;
  attachments?: string[];
  parent_id?: string | null;
  like_count?: number;
  has_liked?: boolean;
  updated_at?: string | null;
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
  gps?: { lat: number; lng: number } | null;
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
  // Allow typing by name (spaces) while preventing trailing-space "re-trigger" after selecting a suggestion.
  // Examples:
  // - "@rod" -> "rod"
  // - "@rodrigo ca" -> "rodrigo ca"
  // - "@rodrigo " -> no match (wait for next char)
  const m = v.match(/@([\p{L}0-9_.-]+(?:\s+[\p{L}0-9_.-]+)*)$/u);
  return m?.[1] || "";
};

const detectCampaignQuery = (text: string) => {
  const v = String(text || "");
  const q = v.match(/&"([^"]{0,80})$/);
  if (q) return q[1] || "";
  const u = v.match(/&([^\s#@&]{0,60})$/);
  return u?.[1] || "";
};

const applyMention = (text: string, query: string, handle: string) => {
  const q = String(query || "").trim();
  const h = String(handle || "").trim();
  if (!q || !h) return text;
  const suffix = `@${q}`;
  if (!text.endsWith(suffix)) return text;
  return `${text.slice(0, text.length - suffix.length)}@${h} `;
};

const applyCampaign = (text: string, query: string, title: string) => {
  const q = String(query || "");
  const t = String(title || "").trim();
  if (!t) return text;
  const quotedSuffix = `&"${q}`;
  if (text.endsWith(quotedSuffix)) {
    return `${text.slice(0, text.length - quotedSuffix.length)}&"${t}" `;
  }
  const suffix = `&${q}`;
  if (text.endsWith(suffix)) {
    // Always insert quoted title to support spaces safely.
    return `${text.slice(0, text.length - suffix.length)}&"${t}" `;
  }
  return text;
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
  const re = /(@[A-Za-z0-9_.-]+|&"[^"\n]{2,160}"|#[\p{L}0-9_]+)/gu;
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

const isImageUrl = (url: string) => {
  const u = String(url || "").toLowerCase();
  return /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(u);
};

const STORAGE_SEPBOOK_LOCATION_CONSENT = "sepbook_location_consent"; // 'allow' | 'deny'

const readLocationConsent = (): "allow" | "deny" | "unknown" => {
  try {
    const raw = localStorage.getItem(STORAGE_SEPBOOK_LOCATION_CONSENT);
    if (raw === "allow" || raw === "deny") return raw;
    return "unknown";
  } catch {
    return "unknown";
  }
};

const writeLocationConsent = (next: "allow" | "deny") => {
  try {
    localStorage.setItem(STORAGE_SEPBOOK_LOCATION_CONSENT, next);
  } catch {
    /* ignore */
  }
};

const clampLatLng = (lat: number, lng: number) => {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
};

const formatGpsLabel = (lat: number, lng: number, source: "photo" | "device") => {
  return source === "photo" ? "GPS da foto" : "Local atual";
};

const sanitizeLocationLabel = (raw: any) => {
  const label = String(raw || "").trim();
  if (!label) return null;
  // Hide raw lat/lng even for older posts that stored coordinates in the label.
  if (/(lat|lng)\s*-?\d{1,2}\.\d+|gps.*-?\d{1,2}\.\d+,\s*-?\d{1,3}\.\d+/i.test(label)) {
    if (/gps da foto/i.test(label)) return "GPS da foto";
    if (/local atual/i.test(label)) return "Local atual";
    return "Localização";
  }
  if (/-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(label)) return "Localização";
  return label;
};

async function extractGpsFromImage(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const t = String(file?.type || "");
    if (!t.startsWith("image/")) return null;
    // Dynamic import to keep the base bundle smaller.
    const mod: any = await import("exifr");
    const exifr: any = mod?.default || mod;
    if (!exifr?.gps) return null;
    const gps = await exifr.gps(file).catch(() => null);
    const lat = gps?.latitude ?? gps?.lat;
    const lng = gps?.longitude ?? gps?.lon ?? gps?.lng;
    return clampLatLng(Number(lat), Number(lng));
  } catch {
    return null;
  }
}

function SepbookFitBounds({
  points,
  disabled,
  token,
}: {
  points: Array<[number, number]>;
  disabled?: boolean;
  token?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (disabled) return;
    if (!map) return;
    if (!points || points.length === 0) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      try {
        const el = map.getContainer?.();
        if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) {
          window.setTimeout(run, 120);
          return;
        }
        map.invalidateSize(true);
        const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14, animate: false });
      } catch {
        /* ignore */
      }
    };
    try {
      map.whenReady(() => {
        window.setTimeout(run, 60);
      });
    } catch {
      window.setTimeout(run, 60);
    }
    return () => {
      cancelled = true;
    };
  }, [map, points, disabled, token]);
  return null;
}

function SepbookMapViewport({ onBoundsChange }: { onBoundsChange: (bounds: L.LatLngBounds) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const handler = () => {
      if (cancelled) return;
      try {
        onBoundsChange(map.getBounds());
      } catch {
        /* ignore */
      }
    };
    try {
      map.whenReady(() => handler());
    } catch {
      handler();
    }
    map.on("moveend", handler);
    map.on("zoomend", handler);
    return () => {
      cancelled = true;
      map.off("moveend", handler);
      map.off("zoomend", handler);
    };
  }, [map, onBoundsChange]);
  return null;
}

function SepbookMapUserActivity({ onActivity }: { onActivity: () => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const handler = () => {
      if (cancelled) return;
      onActivity();
    };
    map.on("dragstart", handler);
    map.on("zoomstart", handler);
    map.on("mousedown", handler);
    map.on("touchstart", handler);
    return () => {
      cancelled = true;
      map.off("dragstart", handler);
      map.off("zoomstart", handler);
      map.off("mousedown", handler);
      map.off("touchstart", handler);
    };
  }, [map, onActivity]);
  return null;
}

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

type CampaignSuggestion = {
  id: string;
  title: string;
  label: string;
  is_active: boolean;
  evidence_challenge_id?: string | null;
};

function useCampaignSuggest(query: string) {
  const [items, setItems] = useState<CampaignSuggestion[]>([]);
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
          const resp = await apiFetch(`/api/campaign-suggest?q=${encodeURIComponent(q)}&limit=20`);
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(json?.error || "Falha ao sugerir campanhas");
          if (!cancelled) setItems(Array.isArray(json.items) ? (json.items as any) : []);
        } catch {
          if (!cancelled) setItems([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 180);

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
  const navigate = useNavigate();
  const { speak, isSpeaking } = useTts();
  const { user, isLeader, studioAccess, userRole, roles } = useAuth() as any;
  const { locale, t: tr } = useI18n();
  const isAdmin = (Array.isArray(roles) && roles.includes("admin")) || (typeof userRole === "string" && userRole.includes("admin"));
  const canGiveFeedback = Boolean(isLeader || studioAccess || isAdmin);

  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState<{
    userId: string;
    name?: string | null;
    context?: { type: string; url?: string | null; label?: string | null } | null;
  } | null>(null);

  const startFeedback = useCallback(
    (opts: { userId: string | null; name?: string | null; context?: { type: string; url?: string | null; label?: string | null } | null }) => {
      const targetId = String(opts.userId || "").trim();
      if (!targetId) return;
      if (targetId === user?.id) {
        toast({ title: "Você não pode enviar feedback para si mesmo.", variant: "destructive" });
        return;
      }
      setFeedbackTarget({ userId: targetId, name: opts.name || null, context: opts.context || null });
      setFeedbackDialogOpen(true);
    },
    [toast, user?.id],
  );

  const [posts, setPosts] = useState<SepPost[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedWarning, setFeedWarning] = useState<string | null>(null);

  const [sortMode, setSortMode] = useState<"newest" | "oldest" | "author_az">("newest");
  const [filterMine, setFilterMine] = useState(false);
  const [filterUserId, setFilterUserId] = useState<string | null>(null);
  const [filterCampaignId, setFilterCampaignId] = useState<string | null>(null);
  const [authorPickerOpen, setAuthorPickerOpen] = useState(false);
  const [authorQuery, setAuthorQuery] = useState("");
  const [campaignPickerOpen, setCampaignPickerOpen] = useState(false);
  const [campaignQuery, setCampaignQuery] = useState("");
  const [campaignOptions, setCampaignOptions] = useState<CampaignSuggestion[]>([]);
  const [campaignOptionsLoading, setCampaignOptionsLoading] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [mapSelectedId, setMapSelectedId] = useState<string | null>(null);
  const [mapHasInteracted, setMapHasInteracted] = useState(false);
  const [mapFitToken, setMapFitToken] = useState(0);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const isMobileDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }, []);

  const [locationConsent, setLocationConsent] = useState<"allow" | "deny" | "unknown">("unknown");
  const [locationConsentDialogOpen, setLocationConsentDialogOpen] = useState(false);
  const [useDeviceLocationDialogOpen, setUseDeviceLocationDialogOpen] = useState(false);
  const locationConsentResolverRef = useRef<((allowed: boolean) => void) | null>(null);
  const useDeviceLocationResolverRef = useRef<((allowed: boolean) => void) | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [composerMentionQuery, setComposerMentionQuery] = useState("");
  const composerMentions = useMentionSuggest(composerMentionQuery);
  const [composerCampaignQuery, setComposerCampaignQuery] = useState("");
  const composerCampaigns = useCampaignSuggest(composerCampaignQuery);
  const [composerCampaignId, setComposerCampaignId] = useState<string | null>(null);
  const [composerCampaignLabel, setComposerCampaignLabel] = useState<string | null>(null);
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
  const [commentToolsOpen, setCommentToolsOpen] = useState(false);
  const commentCameraRef = useRef<HTMLInputElement | null>(null);
  const commentGalleryRef = useRef<HTMLInputElement | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [commentLiking, setCommentLiking] = useState<Record<string, boolean>>({});
  const [replyTarget, setReplyTarget] = useState<SepComment | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [editingCommentSaving, setEditingCommentSaving] = useState(false);
  const [cleaningComment, setCleaningComment] = useState(false);
  const [cleaningCommentEdit, setCleaningCommentEdit] = useState(false);
  const [cleaningComposer, setCleaningComposer] = useState(false);

  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [mentionsItems, setMentionsItems] = useState<any[]>([]);

  const [likesOpenFor, setLikesOpenFor] = useState<string | null>(null);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likers, setLikers] = useState<LikeUser[]>([]);

  const deepLinkCommentTargetRef = useRef<{ commentId: string; postId: string } | null>(null);
  const deepLinkCommentHandledRef = useRef<string | null>(null);
  const deepLinkPostHandledRef = useRef<string | null>(null);

  const activePost = useMemo(() => posts.find((p) => p.id === commentsOpenFor) || null, [commentsOpenFor, posts]);

  const [fallbackTranslations, setFallbackTranslations] = useState<Record<string, string>>({});
  const translationInFlightRef = useRef(0);

  const composerGpsFromPhoto = useMemo(() => {
    const items = composerMedia.filter((m) => m.kind === "image");
    for (const it of items) {
      if (it.gps && typeof it.gps.lat === "number" && typeof it.gps.lng === "number") return it.gps;
    }
    return null;
  }, [composerMedia]);

  const authorOptions = useMemo(() => {
    const map = new Map<
      string,
      { user_id: string; author_name: string; author_team: string | null; author_avatar: string | null }
    >();
    posts.forEach((p) => {
      if (!p.user_id) return;
      if (!map.has(p.user_id)) {
        map.set(p.user_id, {
          user_id: p.user_id,
          author_name: p.author_name,
          author_team: p.author_team || null,
          author_avatar: p.author_avatar || null,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.author_name || "").localeCompare(String(b.author_name || ""), undefined, { sensitivity: "base" }),
    );
  }, [posts]);

  useEffect(() => {
    if (!campaignPickerOpen) return;
    let cancelled = false;
    setCampaignOptionsLoading(true);
    (async () => {
      try {
        const resp = await apiFetch(`/api/campaign-suggest?q=${encodeURIComponent(String(campaignQuery || "").trim())}&limit=60`);
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao carregar campanhas");
        if (!cancelled) setCampaignOptions(Array.isArray(json.items) ? (json.items as any) : []);
      } catch {
        if (!cancelled) setCampaignOptions([]);
      } finally {
        if (!cancelled) setCampaignOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignPickerOpen, campaignQuery]);

  const visiblePosts = useMemo(() => {
    const uid = user?.id || null;
    let items = posts.slice();
    if (filterMine && uid) {
      items = items.filter((p) => p.user_id === uid);
    } else if (filterUserId) {
      items = items.filter((p) => p.user_id === filterUserId);
    }
    if (filterCampaignId) {
      items = items.filter((p) => String((p as any)?.campaign_id || "") === String(filterCampaignId));
    }

    if (sortMode === "oldest") {
      items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else if (sortMode === "author_az") {
      items.sort((a, b) => {
        const an = String(a.author_name || "");
        const bn = String(b.author_name || "");
        const byName = an.localeCompare(bn, undefined, { sensitivity: "base" });
        if (byName !== 0) return byName;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    } else {
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return items;
  }, [filterCampaignId, filterMine, filterUserId, posts, sortMode, user?.id]);

  const mapPosts = useMemo(() => {
    return visiblePosts
      .filter((p) => typeof p.location_lat === "number" && typeof p.location_lng === "number")
      .map((p) => {
        const imageUrl = (Array.isArray(p.attachments) ? p.attachments : []).find((u) => isImageUrl(u)) || null;
        return { post: p, imageUrl };
      })
      .filter((x) => Boolean(x.imageUrl));
  }, [visiblePosts]);

  const visibleMapPosts = useMemo(() => {
    if (!mapBounds) return mapPosts;
    return mapPosts.filter((x) => {
      const lat = Number(x.post.location_lat);
      const lng = Number(x.post.location_lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      return mapBounds.contains(L.latLng(lat, lng));
    });
  }, [mapBounds, mapPosts]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (!mapPosts.length) return [-23.55052, -46.633308]; // fallback: São Paulo
    const sum = mapPosts.reduce(
      (acc, item) => {
        acc.lat += Number(item.post.location_lat || 0);
        acc.lng += Number(item.post.location_lng || 0);
        return acc;
      },
      { lat: 0, lng: 0 },
    );
    return [sum.lat / mapPosts.length, sum.lng / mapPosts.length];
  }, [mapPosts]);

  const openPostById = useCallback((postId: string) => {
    const id = String(postId || "").trim();
    if (!id) return;
    setMapOpen(false);
    setAuthorPickerOpen(false);
    window.setTimeout(() => {
      const el = document.getElementById(`post-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, []);

  const selectedMapPost = useMemo(() => {
    if (!mapSelectedId) return null;
    return mapPosts.find((x) => x.post.id === mapSelectedId) || null;
  }, [mapPosts, mapSelectedId]);

  const selectedMapLinks = useMemo(() => {
    if (!selectedMapPost) return null;
    const lat = Number(selectedMapPost.post.location_lat);
    const lng = Number(selectedMapPost.post.location_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    return { mapsUrl, wazeUrl };
  }, [selectedMapPost]);

  const selectedMarkerIcon = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48" viewBox="0 0 32 48"><path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 32 16 32s16-20 16-32C32 7.2 24.8 0 16 0z" fill="#fbbf24"/><circle cx="16" cy="16" r="6" fill="#ffffff"/></svg>`;
    const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    return new L.Icon({
      iconUrl: url,
      iconSize: [32, 48],
      iconAnchor: [16, 48],
      popupAnchor: [0, -44],
      shadowUrl: markerShadowUrl,
      shadowSize: [41, 41],
      shadowAnchor: [13, 41],
    });
  }, []);

  const defaultMarkerIcon = useMemo(() => new L.Icon.Default(), []);

  const focusMapPost = useCallback(
    (postId: string, opts?: { openPost?: boolean }) => {
      const id = String(postId || "").trim();
      if (!id) return;
      setMapSelectedId(id);
      const target = mapPosts.find((x) => x.post.id === id);
      if (target && mapInstanceRef.current) {
        const lat = Number(target.post.location_lat);
        const lng = Number(target.post.location_lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          try {
            const bounds = mapInstanceRef.current.getBounds?.();
            const inView = bounds ? bounds.contains(L.latLng(lat, lng)) : false;
            const nextZoom = Math.max(mapInstanceRef.current.getZoom(), 14);
            if (!inView) {
              mapInstanceRef.current.setView([lat, lng], nextZoom, { animate: true });
            } else if (mapInstanceRef.current.getZoom() < 14) {
              mapInstanceRef.current.setView([lat, lng], nextZoom, { animate: true });
            }
          } catch {
            mapInstanceRef.current.setView([lat, lng], Math.max(mapInstanceRef.current.getZoom(), 14), { animate: true });
          }
        }
      }
      if (opts?.openPost) {
        openPostById(id);
      }
    },
    [mapPosts, openPostById],
  );

  const handleMapSelection = useCallback(
    (postId: string, opts?: { openOnSecond?: boolean; openPost?: boolean }) => {
      const id = String(postId || "").trim();
      if (!id) return;
      setMapHasInteracted(true);
      const isSelected = mapSelectedId === id;
      if (!isSelected) {
        focusMapPost(id);
        return;
      }
      if (opts?.openPost || opts?.openOnSecond) {
        focusMapPost(id, { openPost: true });
      } else {
        focusMapPost(id);
      }
    },
    [focusMapPost, mapSelectedId],
  );

  useEffect(() => {
    setLocationConsent(readLocationConsent());
  }, []);

  useEffect(() => {
    setFallbackTranslations({});
  }, [locale]);

  const getPostDisplayText = useCallback(
    (post: SepPost | null) => {
      const raw = String(post?.content_md || "");
      const stored = (post as any)?.translations?.[locale];
      if (typeof stored === "string" && stored.trim()) return stored;
      const fallback = post?.id ? fallbackTranslations[`post:${post.id}`] : null;
      if (typeof fallback === "string" && fallback.trim()) return fallback;
      return raw;
    },
    [fallbackTranslations, locale],
  );

  const getCommentDisplayText = useCallback(
    (comment: SepComment | null) => {
      const raw = String(comment?.content_md || "");
      const stored = (comment as any)?.translations?.[locale];
      if (typeof stored === "string" && stored.trim()) return stored;
      const fallback = comment?.id ? fallbackTranslations[`comment:${comment.id}`] : null;
      if (typeof fallback === "string" && fallback.trim()) return fallback;
      return raw;
    },
    [fallbackTranslations, locale],
  );

  useEffect(() => {
    if (locale === "pt-BR") return;

    const toTranslateByText = new Map<string, string[]>();
    const add = (key: string, text: string) => {
      const v = String(text || "").trim();
      if (!v) return;
      const list = toTranslateByText.get(v) || [];
      list.push(key);
      toTranslateByText.set(v, list);
    };

    visiblePosts.slice(0, 60).forEach((p) => {
      const stored = (p as any)?.translations?.[locale];
      if (typeof stored === "string" && stored.trim()) return;
      add(`post:${p.id}`, String(p.content_md || ""));
    });

    if (commentsOpenFor) {
      (commentsByPost[commentsOpenFor] || []).slice(0, 120).forEach((c) => {
        const stored = (c as any)?.translations?.[locale];
        if (typeof stored === "string" && stored.trim()) return;
        add(`comment:${c.id}`, String(c.content_md || ""));
      });
    }

    const texts = Array.from(toTranslateByText.keys()).slice(0, 60);
    if (texts.length === 0) return;

    const run = ++translationInFlightRef.current;
    (async () => {
      try {
        const translated = await translateTextsCached({ targetLocale: locale, texts });
        if (translationInFlightRef.current !== run) return;
        setFallbackTranslations((prev) => {
          const next = { ...prev };
          translated.forEach((t, idx) => {
            const keys = toTranslateByText.get(texts[idx]) || [];
            keys.forEach((k) => {
              next[k] = t;
            });
          });
          return next;
        });
      } catch {
        /* ignore */
      }
    })();
  }, [commentsByPost, commentsOpenFor, locale, visiblePosts]);

  const requestLocationConsent = useCallback(async () => {
    if (locationConsent === "allow") return true;
    if (locationConsent === "deny") return false;
    return await new Promise<boolean>((resolve) => {
      locationConsentResolverRef.current = resolve;
      setLocationConsentDialogOpen(true);
    });
  }, [locationConsent]);

  const requestUseDeviceLocation = useCallback(async () => {
    return await new Promise<boolean>((resolve) => {
      useDeviceLocationResolverRef.current = resolve;
      setUseDeviceLocationDialogOpen(true);
    });
  }, []);

  const getCurrentPosition = useCallback(async (): Promise<{ lat: number; lng: number } | null> => {
    try {
      if (typeof navigator === "undefined" || !navigator.geolocation) return null;
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 9000,
          maximumAge: 30000,
        });
      });
      return clampLatLng(pos.coords.latitude, pos.coords.longitude);
    } catch {
      return null;
    }
  }, []);

  const resolveLocationForNewPost = useCallback(async () => {
    const allowed = await requestLocationConsent();
    if (!allowed) return null;

    // Prefer EXIF GPS from the image, if present.
    if (composerGpsFromPhoto) {
      return {
        location_lat: composerGpsFromPhoto.lat,
        location_lng: composerGpsFromPhoto.lng,
        location_label: formatGpsLabel(composerGpsFromPhoto.lat, composerGpsFromPhoto.lng, "photo"),
      };
    }

    // No EXIF GPS: confirm with the user every time before using device location.
    const ok = await requestUseDeviceLocation();
    if (!ok) return null;

    const coords = await getCurrentPosition();
    if (!coords) {
      toast({
        title: "Localização indisponível",
        description: "Não foi possível obter sua localização atual. A publicação será enviada sem GPS.",
      });
      return null;
    }

    return {
      location_lat: coords.lat,
      location_lng: coords.lng,
      location_label: formatGpsLabel(coords.lat, coords.lng, "device"),
    };
  }, [composerGpsFromPhoto, getCurrentPosition, requestLocationConsent, requestUseDeviceLocation, toast]);

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

  const likesCountLabel = useCallback(
    (countRaw: number) => {
      const count = Math.max(0, Number(countRaw) || 0);
      if (locale === "en") return `${count} like${count === 1 ? "" : "s"}`;
      if (locale === "zh-CN") return `${count} 赞`;
      return `${count} curtida${count === 1 ? "" : "s"}`;
    },
    [locale],
  );

  const viewAllCommentsLabel = useCallback(
    (countRaw: number) => {
      const count = Math.max(0, Number(countRaw) || 0);
      if (locale === "en") return `View all ${count} comment${count === 1 ? "" : "s"}`;
      if (locale === "zh-CN") return `查看全部 ${count} 条评论`;
      return `Ver todos os ${count} comentário${count === 1 ? "" : "s"}`;
    },
    [locale],
  );

  const runCleanup = useCallback(
    async (input: { text: string; title: string }) => {
      const base = String(input.text || "").trim();
      if (base.length < 3) {
        return { ok: false, reason: "too_short" as const };
      }
      const resp = await apiFetch("/api/ai?handler=cleanup-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          description: base,
          language: localeToOpenAiLanguageTag(locale),
        }),
      });
      const json = await resp.json().catch(() => ({}));
      const usedAI = json?.meta?.usedAI !== false;
      if (!resp.ok || !json?.cleaned?.description) {
        return { ok: false, reason: "failed" as const, error: json?.error };
      }
      if (!usedAI) {
        return { ok: false, reason: "unavailable" as const };
      }
      const cleaned = String(json.cleaned.description || base).trim();
      return { ok: true, cleaned, changed: cleaned !== base };
    },
    [locale],
  );

  const loadFeed = useCallback(async () => {
    setLoadingFeed(true);
    setFeedWarning(null);
    try {
      const resp = await apiFetch("/api/sepbook-feed");
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar feed");
      const items = Array.isArray(json.items) ? (json.items as any) : [];
      setPosts((prev) => {
        const next = items as any[];
        const nextIds = new Set(next.map((p) => String(p?.id || "")));
        const extras = (prev as any[]).filter((p) => !nextIds.has(String(p?.id || "")));
        return [...extras, ...next] as any;
      });
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
      setReplyTarget(null);
      setEditingCommentId(null);
      setEditingCommentText("");
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

  const deletePost = useCallback(
    async (post: SepPost) => {
      const id = String(post?.id || "").trim();
      if (!id) return;
      if (!confirm("Excluir esta publicação?")) return;
      try {
        const resp = await apiFetch("/api/sepbook-moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete_post", post_id: id }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao excluir publicação");
        setPosts((prev) => prev.filter((p) => p.id !== id));
        setCommentsByPost((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        toast({ title: "Publicação removida" });
      } catch (e: any) {
        toast({ title: "Erro ao excluir", description: e?.message || "Tente novamente", variant: "destructive" });
      }
    },
    [toast],
  );

  const toggleCommentLike = useCallback(
    async (postId: string, comment: SepComment) => {
      const cid = String(comment?.id || "").trim();
      if (!cid) return;
      if (commentLiking[cid]) return;
      const wasLiked = Boolean(comment.has_liked);
      const nextLiked = !wasLiked;
      setCommentLiking((prev) => ({ ...prev, [cid]: true }));
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).map((c) =>
          c.id === cid
            ? { ...c, has_liked: nextLiked, like_count: Math.max(0, (c.like_count || 0) + (nextLiked ? 1 : -1)) }
            : c,
        ),
      }));
      try {
        const resp = await apiFetch("/api/sepbook-react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment_id: cid, action: nextLiked ? "like" : "unlike" }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao reagir");
        const nextCount = typeof json.like_count === "number" ? json.like_count : undefined;
        if (typeof nextCount === "number") {
          setCommentsByPost((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map((c) => (c.id === cid ? { ...c, like_count: nextCount } : c)),
          }));
        }
      } catch (e: any) {
        setCommentsByPost((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((c) =>
            c.id === cid
              ? { ...c, has_liked: wasLiked, like_count: Math.max(0, (c.like_count || 0) + (wasLiked ? 1 : -1)) }
              : c,
          ),
        }));
        toast({ title: "Curtida", description: e?.message || "Não foi possível reagir", variant: "destructive" });
      } finally {
        setCommentLiking((prev) => ({ ...prev, [cid]: false }));
      }
    },
    [commentLiking, toast],
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
    const preview = getPostDisplayText(post).trim().replace(/\s+/g, " ").slice(0, 140);
    openWhatsAppShare({
      message: preview
        ? `Veja esta publicação no SEPBook (DJT Quest):\n"${preview}${preview.length >= 140 ? "…" : ""}"`
        : "Veja esta publicação no SEPBook (DJT Quest):",
      url,
    });
  }, [getPostDisplayText]);

  const shareComment = useCallback((postId: string, comment: SepComment) => {
    const url = buildAbsoluteAppUrl(`/sepbook?comment=${encodeURIComponent(comment.id)}#post-${encodeURIComponent(postId)}`);
    const preview = getCommentDisplayText(comment).trim().replace(/\s+/g, " ").slice(0, 140);
    openWhatsAppShare({
      message: preview
        ? `Comentário no SEPBook (DJT Quest):\n"${preview}${preview.length >= 140 ? "…" : ""}"`
        : "Comentário no SEPBook (DJT Quest):",
      url,
    });
  }, [getCommentDisplayText]);

  const renderCommentItem = (postId: string, comment: SepComment, isReply = false) => {
    const text = String(getCommentDisplayText(comment) || "").trim();
    const hasAtt = Array.isArray(comment.attachments) && comment.attachments.length > 0;
    const isOwn = Boolean(user?.id && comment.user_id === user.id);
    const isEditing = editingCommentId === comment.id;
    const isDeleted = !text && !hasAtt;
    const likeCount = Math.max(0, Number(comment.like_count || 0));
    const wasEdited =
      comment.updated_at &&
      new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime() > 1000;

    return (
      <div key={comment.id} id={`comment-${comment.id}`} className={cn("flex items-start gap-2", isReply && "pl-4 border-l border-border/60")}>
        <UserProfilePopover userId={comment.user_id} name={comment.author_name} avatarUrl={comment.author_avatar}>
          <Avatar className="h-8 w-8">
            <AvatarImage src={comment.author_avatar || undefined} alt={comment.author_name || "Autor"} />
            <AvatarFallback>{initials(comment.author_name)}</AvatarFallback>
          </Avatar>
        </UserProfilePopover>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <UserProfilePopover userId={comment.user_id} name={comment.author_name} avatarUrl={comment.author_avatar}>
                <button type="button" className="text-[13px] font-semibold truncate">
                  {formatName(comment.author_name)}
                </button>
              </UserProfilePopover>{" "}
              {comment.author_team ? <span className="text-[12px] text-muted-foreground">{comment.author_team}</span> : null}
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => void speakText(text)}
                disabled={isSpeaking || !text}
                aria-label={tr("sepbook.listen")}
                title={tr("sepbook.listen")}
              >
                <Volume2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => commentsOpenFor && shareComment(commentsOpenFor, comment)}
                aria-label={tr("sepbook.share")}
                title={tr("sepbook.share")}
              >
                <Share2 className="h-4 w-4" />
              </Button>
              {isOwn && !isEditing ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => startEditComment(comment)}
                  aria-label={tr("sepbook.edit")}
                  title={tr("sepbook.edit")}
                  disabled={isDeleted}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : null}
              {isOwn && !isEditing && !isDeleted ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => void deleteComment(postId, comment)}
                  aria-label="Excluir comentário"
                  title="Excluir comentário"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>

          {isEditing ? (
            <div className="mt-1 space-y-2">
              <Textarea
                rows={3}
                value={editingCommentText}
                onChange={(e) => setEditingCommentText(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCleanupCommentEdit}
                  disabled={cleaningCommentEdit}
                >
                  <Wand2 className="h-4 w-4 mr-1" />
                  {tr("sepbook.cleanup")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => saveCommentEdit(postId, comment)}
                  disabled={editingCommentSaving}
                >
                  <Check className="h-4 w-4 mr-1" />
                  {tr("sepbook.save")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelEditComment} disabled={editingCommentSaving}>
                  <X className="h-4 w-4 mr-1" />
                  {tr("sepbook.cancel")}
                </Button>
              </div>
              {hasAtt ? (
                <AttachmentViewer urls={comment.attachments || []} postId={comment.post_id} mediaLayout="grid" />
              ) : null}
            </div>
          ) : (
            <>
              {isDeleted ? (
                <div className="text-[13px] mt-0.5 italic text-muted-foreground">Comentário removido</div>
              ) : text ? (
                <div className="text-[13px] mt-0.5">{renderRichText(toast, text)}</div>
              ) : null}
              {hasAtt ? (
                <AttachmentViewer urls={comment.attachments || []} postId={comment.post_id} mediaLayout="grid" />
              ) : null}
            </>
          )}

          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{new Date(comment.created_at).toLocaleString()}</span>
            {wasEdited ? <span>{tr("sepbook.edited")}</span> : null}
          </div>

          {!isEditing && (
            <div className="mt-1 flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => void toggleCommentLike(postId, comment)}
                disabled={commentLiking[comment.id]}
                aria-label={comment.has_liked ? tr("sepbook.unlike") : tr("sepbook.like")}
                title={comment.has_liked ? tr("sepbook.unlike") : tr("sepbook.like")}
              >
                <Heart className={cn("h-4 w-4", comment.has_liked && "fill-rose-500 text-rose-500")} />
              </Button>
              <span className="text-[12px] text-muted-foreground">{likeCount}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReplyTarget(comment);
                  requestAnimationFrame(() => commentInputRef.current?.focus());
                }}
              >
                <Reply className="h-4 w-4 mr-1" />
                {tr("sepbook.reply")}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

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
        const gps =
          opts.context === "post" && kind === "image"
            ? await extractGpsFromImage(file)
            : null;
        const item: MediaItem = { id, file, kind, previewUrl, gps, uploading: true, progress: 30 };
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

  const handleCleanupComposer = useCallback(async () => {
    if (cleaningComposer) return;
    setCleaningComposer(true);
    try {
      const result = await runCleanup({ text: composerText, title: "Publicação SEPBook" });
      if (!result.ok) {
        if (result.reason === "too_short") {
          toast({ title: "Nada para revisar", description: "Digite um texto antes de pedir correção." });
        } else {
          toast({
            title: "Não foi possível revisar",
            description: "IA indisponível no momento. Tente novamente mais tarde.",
            variant: "destructive",
          });
        }
        return;
      }
      if (!result.changed) {
        toast({ title: "Nenhuma correção necessária", description: "Não encontrei ajustes para fazer." });
        return;
      }
      setComposerText(result.cleaned);
      toast({ title: "Texto revisado", description: "Ortografia e pontuação ajustadas." });
    } catch (e: any) {
      toast({ title: "Não foi possível revisar", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setCleaningComposer(false);
    }
  }, [cleaningComposer, composerText, runCleanup, toast]);

  const handleCleanupCommentDraft = useCallback(async () => {
    if (cleaningComment) return;
    setCleaningComment(true);
    try {
      const result = await runCleanup({ text: commentText, title: "Comentário SEPBook" });
      if (!result.ok) {
        if (result.reason === "too_short") {
          toast({ title: "Nada para revisar", description: "Digite um comentário antes de pedir correção." });
        } else {
          toast({
            title: "Não foi possível revisar",
            description: "IA indisponível no momento. Tente novamente mais tarde.",
            variant: "destructive",
          });
        }
        return;
      }
      if (!result.changed) {
        toast({ title: "Nenhuma correção necessária", description: "Não encontrei ajustes para fazer." });
        return;
      }
      setCommentText(result.cleaned);
    } catch (e: any) {
      toast({ title: "Não foi possível revisar", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setCleaningComment(false);
    }
  }, [cleaningComment, commentText, runCleanup, toast]);

  const handleCleanupCommentEdit = useCallback(async () => {
    if (cleaningCommentEdit) return;
    setCleaningCommentEdit(true);
    try {
      const result = await runCleanup({ text: editingCommentText, title: "Comentário SEPBook" });
      if (!result.ok) {
        if (result.reason === "too_short") {
          toast({ title: "Nada para revisar", description: "Digite um comentário antes de pedir correção." });
        } else {
          toast({
            title: "Não foi possível revisar",
            description: "IA indisponível no momento. Tente novamente mais tarde.",
            variant: "destructive",
          });
        }
        return;
      }
      if (!result.changed) {
        toast({ title: "Nenhuma correção necessária", description: "Não encontrei ajustes para fazer." });
        return;
      }
      setEditingCommentText(result.cleaned);
    } catch (e: any) {
      toast({ title: "Não foi possível revisar", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setCleaningCommentEdit(false);
    }
  }, [cleaningCommentEdit, editingCommentText, runCleanup, toast]);

  const startEditComment = useCallback((comment: SepComment) => {
    setEditingCommentId(comment.id);
    setEditingCommentText(String(comment.content_md || ""));
  }, []);

  const cancelEditComment = useCallback(() => {
    setEditingCommentId(null);
    setEditingCommentText("");
  }, []);

  const saveCommentEdit = useCallback(
    async (postId: string, comment: SepComment) => {
      const text = String(editingCommentText || "").trim();
      if (text.length < 2 && !(comment.attachments && comment.attachments.length > 0)) {
        toast({ title: "Texto obrigatório", description: "Digite um comentário ou mantenha um anexo." });
        return;
      }
      setEditingCommentSaving(true);
      try {
        const resp = await apiFetch("/api/sepbook-comments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            comment_id: comment.id,
            content_md: text,
            attachments: comment.attachments || [],
          }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao atualizar comentário");
        const updated = json?.comment || {
          ...comment,
          content_md: text,
          translations: { ...(comment.translations || {}), "pt-BR": text },
          updated_at: new Date().toISOString(),
        };
        setCommentsByPost((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((c) => (c.id === comment.id ? { ...c, ...updated } : c)),
        }));
        setFallbackTranslations((prev) => ({ ...prev, [`comment:${comment.id}`]: text }));
        cancelEditComment();
        toast({ title: "Comentário atualizado" });
      } catch (e: any) {
        toast({ title: "Erro ao atualizar", description: e?.message || "Tente novamente", variant: "destructive" });
      } finally {
        setEditingCommentSaving(false);
      }
    },
    [cancelEditComment, editingCommentText, toast],
  );

  const deleteComment = useCallback(
    async (postId: string, comment: SepComment) => {
      if (!confirm("Excluir este comentário?")) return;
      try {
        const resp = await apiFetch(`/api/sepbook-comments?comment_id=${encodeURIComponent(comment.id)}`, { method: "DELETE" });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao excluir comentário");

        const mode = String(json?.deleted || "");
        if (mode === "soft") {
          setCommentsByPost((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map((c) =>
              c.id === comment.id
                ? { ...c, content_md: "", attachments: [], like_count: 0, has_liked: false, updated_at: new Date().toISOString() }
                : c,
            ),
          }));
        } else {
          setCommentsByPost((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).filter((c) => c.id !== comment.id),
          }));
          setPosts((prev) =>
            prev.map((p) => (p.id === postId ? { ...p, comment_count: Math.max(0, (p.comment_count || 0) - 1) } : p)),
          );
        }

        if (editingCommentId === comment.id) cancelEditComment();
        toast({ title: "Comentário removido" });
      } catch (e: any) {
        toast({ title: "Erro ao excluir comentário", description: e?.message || "Tente novamente", variant: "destructive" });
      }
    },
    [cancelEditComment, editingCommentId, toast],
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
      const locationPayload = await resolveLocationForNewPost();
      const resp = await apiFetch("/api/sepbook-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_md: text,
          attachments: uploadedComposerUrls,
          campaign_id: composerCampaignId || null,
          ...(locationPayload || {}),
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao postar");
      const post = json?.post as SepPost | undefined;
      if (post?.id) setPosts((prev) => [post, ...prev]);
      setComposerOpen(false);
      setComposerText("");
      setComposerMentionQuery("");
      setComposerCampaignQuery("");
      setComposerCampaignId(null);
      setComposerCampaignLabel(null);
      composerMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
      setComposerMedia([]);
      toast({ title: "Publicado", description: "Sua postagem foi publicada no SEPBook." });
    } catch (e: any) {
      toast({ title: "Publicação", description: e?.message || "Falha ao publicar", variant: "destructive" });
    } finally {
      setComposerSubmitting(false);
    }
  }, [composerCampaignId, composerMedia, composerText, composerUploading, resolveLocationForNewPost, toast, uploadedComposerUrls]);

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
        body: JSON.stringify({
          post_id: postId,
          content_md: text,
          attachments: uploadedCommentUrls,
          parent_id: replyTarget?.id || null,
        }),
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
      setReplyTarget(null);
      setCommentToolsOpen(false);
      commentMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
      setCommentMedia([]);
    } catch (e: any) {
      toast({ title: "Comentário", description: e?.message || "Falha ao comentar", variant: "destructive" });
    } finally {
      setCommentSubmitting(false);
    }
  }, [commentMedia, commentText, commentUploading, commentsOpenFor, replyTarget, toast, uploadedCommentUrls]);

  const loadMentionsInbox = useCallback(async () => {
    setMentionsLoading(true);
    try {
      const resp = await apiFetch(`/api/sepbook-mentions-inbox?limit=40`);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar menções");
      const items = Array.isArray(json.items) ? json.items : [];
      setMentionsItems(items);
      return items;
    } finally {
      setMentionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mentionsOpen) return;
    (async () => {
      try {
        const items = await loadMentionsInbox();
        if (items.length) {
          await apiFetch("/api/sepbook-mentions-mark-seen", { method: "POST", headers: { "Content-Type": "application/json" } });
          window.dispatchEvent(new CustomEvent("sepbook-mentions-seen"));
        }
      } catch {
        // ignore
      }
    })();
  }, [loadMentionsInbox, mentionsOpen]);

  // Mark last seen on entry (best-effort) and clear only "new posts" badge
  useEffect(() => {
    (async () => {
      try {
        await apiFetch("/api/sepbook-mark-last-seen", { method: "POST", headers: { "Content-Type": "application/json" } });
        window.dispatchEvent(new CustomEvent("sepbook-last-seen-updated"));
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

  // Deep link: #post-<uuid> should work even if the post isn't in the first 50 items
  useEffect(() => {
    const hashId = (routerLocation.hash || "").replace(/^#/, "").trim();
    const m = /^post-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hashId);
    const postId = m?.[1] ? String(m[1]) : "";
    if (!postId) return;
    if (posts.some((p) => String((p as any)?.id || "") === postId)) return;
    if (deepLinkPostHandledRef.current === postId) return;
    deepLinkPostHandledRef.current = postId;

    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch(`/api/sepbook-feed?post_id=${encodeURIComponent(postId)}`);
        const json = await resp.json().catch(() => ({} as any));
        if (!resp.ok) throw new Error(json?.error || "Falha ao buscar post");
        const item = Array.isArray((json as any)?.items) ? (json as any).items[0] : null;
        if (!item) {
          toast({
            title: "Post não encontrado",
            description: "Este post pode ter sido removido ou você não tem permissão.",
            variant: "destructive",
          });
          return;
        }
        if (cancelled) return;
        setPosts((prev) => (prev.some((p) => String((p as any)?.id || "") === String(item.id)) ? prev : [item, ...prev]));
      } catch {
        // silencioso
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [posts, routerLocation.hash, toast]);

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
    const cq = detectCampaignQuery(composerText);
    setComposerCampaignQuery(cq);
    if (!/&"[^"]{2,160}"/.test(String(composerText || ""))) {
      setComposerCampaignId(null);
      setComposerCampaignLabel(null);
    }
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
                alt={tr("sepbook.attachment")}
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
              aria-label={tr("sepbook.remove")}
              title={tr("sepbook.remove")}
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
      <SendUserFeedbackDialog
        open={feedbackDialogOpen}
        onOpenChange={(open) => {
          setFeedbackDialogOpen(open);
          if (!open) setFeedbackTarget(null);
        }}
        recipientId={feedbackTarget?.userId || null}
        recipientName={feedbackTarget?.name || null}
        context={feedbackTarget?.context || null}
      />
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[680px] items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[12px] text-muted-foreground leading-tight">SEPBook</p>
            <h1 className="text-[16px] font-black leading-tight tracking-tight truncate">{tr("sepbook.feedTitle")}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setMentionsOpen(true)}
              aria-label={tr("sepbook.mentions")}
              title={tr("sepbook.mentions")}
            >
              <AtSign className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => {
                setMapSelectedId(null);
                setMapHasInteracted(false);
                setMapFitToken((v) => v + 1);
                setMapOpen(true);
              }}
              aria-label={tr("sepbook.map")}
            >
              <MapPinned className="h-5 w-5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon" variant="ghost" aria-label={tr("sepbook.filtersSort")}>
                  <SlidersHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[260px]">
                <DropdownMenuLabel>{tr("sepbook.sortLabel")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sortMode} onValueChange={(v) => setSortMode(v as any)}>
                  <DropdownMenuRadioItem value="newest">{tr("sepbook.sortNewest")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="oldest">{tr("sepbook.sortOldest")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="author_az">{tr("sepbook.sortAuthorAz")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{tr("sepbook.filterLabel")}</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={filterMine}
                  onCheckedChange={(v) => {
                    const next = Boolean(v);
                    setFilterMine(next);
                    if (next) setFilterUserId(null);
                  }}
                  disabled={!user?.id}
                >
                  {tr("sepbook.filterMine")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem onClick={() => setAuthorPickerOpen(true)}>{tr("sepbook.filterByAuthor")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCampaignPickerOpen(true)}>{tr("sepbook.filterByCampaign")}</DropdownMenuItem>
                {(filterUserId || filterMine || filterCampaignId) && (
                  <DropdownMenuItem
                    onClick={() => {
                      setFilterMine(false);
                      setFilterUserId(null);
                      setFilterCampaignId(null);
                    }}
                  >
                    {tr("sepbook.clearFilters")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="icon" variant="ghost" onClick={() => setComposerOpen(true)} aria-label={tr("sepbook.newPost")}>
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
          <div className="px-4 py-10 text-sm text-muted-foreground">{tr("common.loading")}</div>
        ) : visiblePosts.length === 0 ? (
          <div className="px-4 py-10 text-sm text-muted-foreground">{tr("sepbook.emptyFeed")}</div>
        ) : (
          <div className="flex flex-col">
            {visiblePosts.map((p) => {
              const createdLabel = new Date(p.created_at).toLocaleString();
              const caption = String(getPostDisplayText(p) || "").trim();
              const safeLocationLabel = sanitizeLocationLabel(p.location_label);
              return (
                <article key={p.id} id={`post-${p.id}`} className="border-b">
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserProfilePopover userId={p.user_id} name={p.author_name} avatarUrl={p.author_avatar}>
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={p.author_avatar || undefined} alt={p.author_name || "Autor"} />
                          <AvatarFallback>{initials(p.author_name)}</AvatarFallback>
                        </Avatar>
                      </UserProfilePopover>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <UserProfilePopover userId={p.user_id} name={p.author_name} avatarUrl={p.author_avatar}>
                            <button type="button" className="text-[13px] font-semibold truncate">
                              {formatName(p.author_name)}
                            </button>
                          </UserProfilePopover>
                          {p.author_team ? (
                            <span className="text-[12px] text-muted-foreground truncate">{p.author_team}</span>
                          ) : null}
                        </div>
                        {safeLocationLabel ? (
                          <span className="text-[11px] text-muted-foreground truncate">{safeLocationLabel}</span>
                        ) : null}
                        {p.campaign?.id ? (
                          <button
                            type="button"
                            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline truncate"
                            onClick={() => navigate(`/campaign/${encodeURIComponent(p.campaign!.id)}`)}
                            title={p.campaign?.title || tr("sepbook.campaign")}
                          >
                            <span className="opacity-80">&amp;</span>
                            <span className="truncate">
                              {p.campaign?.title || tr("sepbook.campaign")}
                              {p.campaign && (p.campaign as any).is_active === false ? ` (${tr("sepbook.campaignOffline")})` : ""}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon" variant="ghost" aria-label={tr("sepbook.options")} title={tr("sepbook.options")}>
                          <MoreHorizontal className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[200px]">
                        <DropdownMenuItem
                          onClick={() => {
                            void copyToClipboard(toast, buildAbsoluteAppUrl(`/sepbook#post-${encodeURIComponent(p.id)}`));
                          }}
                        >
                          {tr("sepbook.copyLink")}
                        </DropdownMenuItem>
                        {p.user_id === user?.id ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => void deletePost(p)}>
                              <Trash2 className="h-4 w-4 mr-2" />
                              Excluir publicação
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        {canGiveFeedback && p.user_id !== user?.id && (
                          <DropdownMenuItem
                            onClick={() =>
                              startFeedback({
                                userId: p.user_id,
                                name: p.author_name || null,
                                context: {
                                  type: "sepbook_post",
                                  url: `/sepbook#post-${encodeURIComponent(p.id)}`,
                                  label: caption ? `SEPBook: ${caption.slice(0, 80)}` : "SEPBook",
                                },
                              })
                            }
                          >
                            <MessageCircle className="h-4 w-4 mr-2" />
                            Feedback
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {Array.isArray(p.attachments) && p.attachments.length > 0 ? (
                    <div className="px-0 relative">
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
                      {safeLocationLabel ? (
                        <div className="pointer-events-none absolute left-3 top-3 z-10">
                          <span className="inline-flex items-center rounded-full border bg-background/80 backdrop-blur px-2 py-0.5 text-[11px] font-semibold text-foreground shadow">
                            {safeLocationLabel}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between px-2 pt-1">
                    <div className="flex items-center gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => void toggleLike(p)}
                        aria-label={tr("sepbook.like")}
                      >
                        <Heart className={cn("h-6 w-6", p.has_liked && "fill-rose-500 text-rose-500")} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => void openComments(p.id)}
                        aria-label={tr("sepbook.comment")}
                      >
                        <MessageCircle className="h-6 w-6" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" onClick={() => sharePost(p)} aria-label={tr("sepbook.share")}>
                        <Send className="h-6 w-6" />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void speakText(caption)}
                      aria-label={tr("sepbook.listen")}
                      title={tr("sepbook.listen")}
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
                      aria-label={tr("sepbook.viewLikes")}
                    >
                      {likesCountLabel(p.like_count || 0)}
                    </button>

                    {caption ? (
                      <div className="text-[13px]">
                        <UserProfilePopover userId={p.user_id} name={p.author_name} avatarUrl={p.author_avatar}>
                          <button type="button" className="font-semibold hover:underline p-0 bg-transparent border-0">
                            {formatName(p.author_name)}
                          </button>
                        </UserProfilePopover>{" "}
                        {renderRichText(toast, caption)}
                      </div>
                    ) : null}

                    {p.comment_count > 0 ? (
                      <button
                        type="button"
                        className="text-[13px] text-muted-foreground"
                        onClick={() => void openComments(p.id)}
                      >
                        {viewAllCommentsLabel(p.comment_count)}
                      </button>
                    ) : (
                      <button type="button" className="text-[13px] text-muted-foreground" onClick={() => void openComments(p.id)}>
                        {tr("sepbook.addComment")}
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
            setComposerCampaignQuery("");
            setComposerCampaignId(null);
            setComposerCampaignLabel(null);
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
            <DrawerTitle>{tr("sepbook.newPost")}</DrawerTitle>
            <DrawerDescription className="sr-only">Criar uma nova postagem, com menções e campanha opcional</DrawerDescription>
          </DrawerHeader>

          <div className="px-3 pb-3 space-y-3">
            {renderMediaThumbs(composerMedia, (m) => removeMediaItem(m, setComposerMedia))}

            <div className="flex flex-wrap items-center gap-2">
              <VoiceRecorderButton
                size="sm"
                label={tr("sepbook.voice")}
                onText={(text) => setComposerText((prev) => [prev, text].filter(Boolean).join("\n\n"))}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCleanupComposer}
                disabled={cleaningComposer}
              >
                <Wand2 className="h-4 w-4 mr-1" />
                {tr("sepbook.cleanup")}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => composerCameraRef.current?.click()}
                disabled={composerUploading || composerSubmitting}
                aria-label={tr("sepbook.camera")}
                title={tr("sepbook.camera")}
              >
                <Camera className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => composerGalleryRef.current?.click()}
                disabled={composerUploading || composerSubmitting}
                aria-label={tr("sepbook.gallery")}
                title={tr("sepbook.gallery")}
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
                disabled={
                  composerSubmitting ||
                  composerUploading ||
                  composerMedia.some((m) => m.uploading) ||
                  (!composerText.trim() && uploadedComposerUrls.length === 0)
                }
              >
                {tr("sepbook.publish")}
              </Button>
            </div>

              <Textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder={tr("sepbook.captionPlaceholder")}
                className="min-h-[120px]"
              />

              {composerCampaignId ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/20 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">{tr("sepbook.campaignSelected")}</div>
                    <div className="text-[13px] font-semibold truncate">{composerCampaignLabel || composerCampaignId}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setComposerCampaignId(null);
                      setComposerCampaignLabel(null);
                      setComposerText((prev) => String(prev || "").replace(/&\"[^\"\n]{2,160}\"/g, "").replace(/\s{2,}/g, " "));
                    }}
                  >
                    {tr("sepbook.remove")}
                  </Button>
                </div>
              ) : null}

              {composerCampaignQuery && composerCampaigns.items.length > 0 && (
                <div className="rounded-xl border bg-background">
                  <div className="px-3 py-2 text-[12px] text-muted-foreground">{tr("sepbook.campaignSuggestions")}</div>
                  <div className="max-h-[220px] overflow-auto">
                    {composerCampaigns.items.slice(0, 10).map((c) => (
                      <button
                        key={`camp-${c.id}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted text-[13px]"
                        onClick={() => {
                          setComposerCampaignId(c.id);
                          setComposerCampaignLabel(c.label || c.title);
                          setComposerText((prev) => applyCampaign(prev, composerCampaignQuery, c.title));
                        }}
                      >
                        <span className="font-semibold">&amp;{c.label || c.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {composerMentionQuery && composerMentions.items.length > 0 && (
                <div className="rounded-xl border bg-background">
                  <div className="px-3 py-2 text-[12px] text-muted-foreground">{tr("sepbook.mentionSuggestions")}</div>
                  <div className="max-h-[220px] overflow-auto">
                    {composerMentions.items.slice(0, 12).map((s, idx) => (
                      <button
                        key={`${s.kind}-${s.handle}-${idx}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted text-[13px]"
                        onClick={() => setComposerText((prev) => applyMention(prev, composerMentionQuery, s.handle))}
                      >
                        <span className="font-semibold">@{s.handle}</span> <span className="text-muted-foreground">{s.label}</span>
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
            setReplyTarget(null);
            setEditingCommentId(null);
            setEditingCommentText("");
            commentMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
            setCommentMedia([]);
            setCommentUploading(false);
            setCommentSubmitting(false);
          }
        }}
      >
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader>
            <DrawerTitle>
              {activePost
                ? tr("sepbook.commentsTitleWithAuthor", { author: formatName(activePost.author_name) })
                : tr("sepbook.commentsTitle")}
            </DrawerTitle>
            <DrawerDescription className="sr-only">Lista de comentários e caixa para responder</DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col h-full">
            <ScrollArea className="flex-1 px-3 pb-3">
              {activePost && (
                <div className="mb-3 rounded-xl border bg-muted/20 px-3 py-2">
                  <div className="text-[12px] text-muted-foreground">
                    <UserProfilePopover userId={activePost.user_id} name={activePost.author_name} avatarUrl={activePost.author_avatar}>
                      <button type="button" className="font-semibold">
                        {formatName(activePost.author_name)}
                      </button>
                    </UserProfilePopover>{" "}
                    {activePost.author_team ? `• ${activePost.author_team}` : ""}
                  </div>
                  {String(getPostDisplayText(activePost) || "").trim() ? (
                    <div className="text-[13px] mt-1">{renderRichText(toast, getPostDisplayText(activePost))}</div>
                  ) : null}
                </div>
              )}

              {commentsOpenFor && commentsLoading[commentsOpenFor] ? (
                <div className="py-6 text-sm text-muted-foreground">{tr("sepbook.loadingComments")}</div>
              ) : commentsOpenFor && (commentsByPost[commentsOpenFor] || []).length === 0 ? (
                <div className="py-6 text-sm text-muted-foreground">{tr("sepbook.firstComment")}</div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const allComments = commentsOpenFor ? commentsByPost[commentsOpenFor] || [] : [];
                    const sorted = [...allComments].sort(
                      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                    );
                    const repliesByParent = new Map<string, SepComment[]>();
                    const rootComments: SepComment[] = [];
                    for (const c of sorted) {
                      const parentId = c.parent_id ? String(c.parent_id) : "";
                      if (parentId) {
                        const list = repliesByParent.get(parentId) || [];
                        list.push(c);
                        repliesByParent.set(parentId, list);
                      } else {
                        rootComments.push(c);
                      }
                    }
                    return rootComments.map((c) => (
                      <div key={c.id} className="space-y-2">
                        {renderCommentItem(commentsOpenFor!, c)}
                        {(repliesByParent.get(c.id) || []).map((r) => renderCommentItem(commentsOpenFor!, r, true))}
                      </div>
                    ));
                  })()}
                </div>
              )}
            </ScrollArea>

            <div className="border-t bg-background px-3 py-3 space-y-2">
              {replyTarget && (
                <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-[12px]">
                  <span>
                    {tr("sepbook.replyingTo")}{" "}
                    <strong>{formatName(replyTarget.author_name)}</strong>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setReplyTarget(null)}>
                    {tr("sepbook.cancelReply")}
                  </Button>
                </div>
              )}

              {renderMediaThumbs(commentMedia, (m) => removeMediaItem(m, setCommentMedia))}

              {commentMentionQuery && commentMentions.items.length > 0 && (
                <div className="rounded-xl border bg-background">
                  <div className="px-3 py-2 text-[12px] text-muted-foreground">{tr("sepbook.mentionSuggestions")}</div>
                  <div className="max-h-[160px] overflow-auto">
                    {commentMentions.items
                      .filter((s) => String((s as any)?.kind || "") === "user")
                      .slice(0, 8)
                      .map((s, idx) => (
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

              <div className="hidden sm:flex flex-wrap items-center gap-2">
                <VoiceRecorderButton
                  size="sm"
                  label={tr("sepbook.voice")}
                  onText={(text) => setCommentText((prev) => [prev, text].filter(Boolean).join("\n\n"))}
                />
                <Button type="button" size="sm" variant="outline" onClick={handleCleanupCommentDraft} disabled={cleaningComment}>
                  <Wand2 className="h-4 w-4 mr-1" />
                  {tr("sepbook.cleanup")}
                </Button>
              </div>

              {commentToolsOpen ? (
                <div className="sm:hidden flex flex-wrap items-center gap-2">
                  <VoiceRecorderButton
                    size="sm"
                    label={tr("sepbook.voice")}
                    onText={(text) => setCommentText((prev) => [prev, text].filter(Boolean).join("\n\n"))}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={handleCleanupCommentDraft} disabled={cleaningComment}>
                    <Wand2 className="h-4 w-4 mr-1" />
                    {tr("sepbook.cleanup")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => commentCameraRef.current?.click()}
                    disabled={commentUploading || commentSubmitting}
                  >
                    <Camera className="h-4 w-4 mr-1" />
                    {tr("sepbook.camera")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => commentGalleryRef.current?.click()}
                    disabled={commentUploading || commentSubmitting}
                  >
                    <ImageIcon className="h-4 w-4 mr-1" />
                    {tr("sepbook.gallery")}
                  </Button>
                </div>
              ) : null}

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

              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="sm:hidden"
                  onClick={() => setCommentToolsOpen((v) => !v)}
                  aria-label="Ações do comentário"
                  title="Ações"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="hidden sm:inline-flex"
                  onClick={() => commentCameraRef.current?.click()}
                  disabled={commentUploading || commentSubmitting}
                  aria-label={tr("sepbook.camera")}
                  title={tr("sepbook.camera")}
                >
                  <Camera className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="hidden sm:inline-flex"
                  onClick={() => commentGalleryRef.current?.click()}
                  disabled={commentUploading || commentSubmitting}
                  aria-label={tr("sepbook.gallery")}
                  title={tr("sepbook.gallery")}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>

                <Textarea
                  ref={commentInputRef}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={tr("sepbook.commentPlaceholder")}
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
                  aria-label={tr("sepbook.sendComment")}
                  title={tr("sepbook.send")}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="hidden sm:block text-[11px] text-muted-foreground">{tr("sepbook.commentPhotoHint")}</div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={mentionsOpen} onOpenChange={setMentionsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("sepbook.mentionsTitle")}</DialogTitle>
            <DialogDescription>{tr("sepbook.mentionsDescription")}</DialogDescription>
          </DialogHeader>
          {mentionsLoading ? (
            <div className="py-6 text-sm text-muted-foreground">{tr("sepbook.mentionsLoading")}</div>
          ) : mentionsItems.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">{tr("sepbook.mentionsEmpty")}</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto space-y-2 pr-1">
              {mentionsItems.map((m: any) => {
                const kind = String(m?.kind || (m?.comment_id ? "comment" : "post"));
                const p = m?.post;
                const postId = String(m?.post_id || p?.id || "").trim();
                const commentId = String(m?.comment_id || "").trim();
                const authorName =
                  kind === "comment"
                    ? formatName(m?.comment_author_name)
                    : formatName(p?.author_name);
                const created = m?.created_at ? new Date(m.created_at).toLocaleString() : "";
                const text =
                  kind === "comment"
                    ? String(m?.comment?.content_md || "").trim()
                    : String(getPostDisplayText(p) || "").trim();
                const snippet = text ? text.replace(/\s+/g, " ").slice(0, 180) : tr("sepbook.mentionsNoText");
                return (
                  <button
                    key={`${kind}-${postId || "post"}-${commentId || "x"}-${String(m?.created_at || "")}`}
                    type="button"
                    className="w-full text-left rounded-xl border px-3 py-2 hover:bg-muted"
                    onClick={() => {
                      setMentionsOpen(false);
                      if (!postId) return;
                      if (kind === "comment" && commentId) {
                        navigate(`/sepbook?comment=${encodeURIComponent(commentId)}#post-${encodeURIComponent(postId)}`);
                        return;
                      }
                      openPostById(postId);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] font-semibold truncate">
                        {authorName || (kind === "comment" ? "Comentário" : "Autor")}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{created}</div>
                    </div>
                    {kind === "comment" ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">Menção em comentário</div>
                    ) : (
                      <div className="mt-1 text-[11px] text-muted-foreground">Menção em postagem</div>
                    )}
                    <div className="text-[12px] text-muted-foreground mt-1 whitespace-normal">{snippet}</div>
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(likesOpenFor)} onOpenChange={(open) => !open && setLikesOpenFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("sepbook.likesTitle")}</DialogTitle>
            <DialogDescription>{tr("sepbook.likesDescription")}</DialogDescription>
          </DialogHeader>
          {likesLoading ? (
            <div className="py-6 text-sm text-muted-foreground">{tr("common.loading")}</div>
          ) : likers.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">{tr("sepbook.likesEmpty")}</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto space-y-2 pr-1">
              {likers.map((u) => (
                <UserProfilePopover key={u.user_id} userId={u.user_id} name={u.name} avatarUrl={u.avatar_url}>
                  <button type="button" className="flex items-center gap-3 rounded-lg border px-3 py-2 text-left w-full bg-transparent">
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
                  </button>
                </UserProfilePopover>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={authorPickerOpen} onOpenChange={setAuthorPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("sepbook.authorFilterTitle")}</DialogTitle>
            <DialogDescription>{tr("sepbook.authorFilterDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={authorQuery}
              onChange={(e) => setAuthorQuery(e.target.value)}
              placeholder={tr("sepbook.authorSearchPlaceholder")}
            />
            <div className="max-h-[55vh] overflow-auto space-y-1 pr-1">
              {authorOptions
                .filter((a) => {
                  const q = String(authorQuery || "").trim().toLowerCase();
                  if (!q) return true;
                  const hay = `${a.author_name || ""} ${a.author_team || ""}`.toLowerCase();
                  return hay.includes(q);
                })
                .slice(0, 120)
                .map((a) => (
                  <button
                    key={a.user_id}
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-3 rounded-lg border px-3 py-2 hover:bg-muted text-left",
                      filterUserId === a.user_id && "border-primary",
                    )}
                    onClick={() => {
                      setFilterMine(false);
                      setFilterUserId(a.user_id);
                      setAuthorPickerOpen(false);
                    }}
                  >
                    <UserProfilePopover userId={a.user_id} name={a.author_name} avatarUrl={a.author_avatar}>
                      <button
                        type="button"
                        className="flex items-center gap-3 min-w-0 flex-1 text-left p-0 bg-transparent border-0"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={a.author_avatar || undefined} alt={a.author_name || "Autor"} />
                          <AvatarFallback>{initials(a.author_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold truncate">{formatName(a.author_name)}</div>
                          <div className="text-[12px] text-muted-foreground truncate">{a.author_team || "DJT"}</div>
                        </div>
                      </button>
                    </UserProfilePopover>
                  </button>
                ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={campaignPickerOpen} onOpenChange={setCampaignPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("sepbook.campaignFilterTitle")}</DialogTitle>
            <DialogDescription>{tr("sepbook.campaignFilterDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={campaignQuery}
              onChange={(e) => setCampaignQuery(e.target.value)}
              placeholder={tr("sepbook.campaignSearchPlaceholder")}
            />
            {campaignOptionsLoading ? (
              <div className="py-6 text-sm text-muted-foreground">{tr("common.loading")}</div>
            ) : campaignOptions.length === 0 ? (
              <div className="py-6 text-sm text-muted-foreground">{tr("sepbook.campaignFilterEmpty")}</div>
            ) : (
              <div className="max-h-[55vh] overflow-auto space-y-1 pr-1">
                {campaignOptions.slice(0, 120).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={cn(
                      "w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2 hover:bg-muted text-left",
                      filterCampaignId === c.id && "border-primary",
                    )}
                    onClick={() => {
                      setFilterCampaignId(c.id);
                      setCampaignPickerOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">{c.title}</div>
                      <div className="text-[12px] text-muted-foreground truncate">{c.label}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {filterCampaignId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFilterCampaignId(null);
                  setCampaignPickerOpen(false);
                }}
              >
                {tr("sepbook.clearCampaignFilter")}
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mapOpen}
        onOpenChange={(open) => {
          if (!open) {
            try {
              mapInstanceRef.current?.off();
              mapInstanceRef.current?.stop();
              mapInstanceRef.current?.remove();
            } catch {
              /* ignore */
            }
            setMapBounds(null);
            setMapSelectedId(null);
            setMapHasInteracted(false);
          }
          if (open) {
            setMapBounds(null);
            setMapSelectedId(null);
            setMapHasInteracted(false);
            setMapFitToken((v) => v + 1);
          }
          setMapOpen(open);
          if (!open) mapInstanceRef.current = null;
        }}
      >
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>{tr("sepbook.mapTitle")}</DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              {tr("sepbook.mapDescription")}
            </DialogDescription>
          </DialogHeader>

          {mapPosts.length === 0 ? (
            <div className="px-4 pb-6 text-sm text-muted-foreground">{tr("sepbook.mapEmpty")}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t">
              <div className="h-[48vh] md:h-[70vh] border-b md:border-b-0 md:border-r">
                <div className="relative h-full w-full">
                  <MapContainer
                    center={mapCenter}
                    zoom={12}
                    scrollWheelZoom
                    zoomControl={false}
                    zoomAnimation={false}
                    fadeAnimation={false}
                    markerZoomAnimation={false}
                    whenCreated={(map) => {
                      mapInstanceRef.current = map;
                    }}
                    className="h-full w-full"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <SepbookFitBounds
                      points={mapPosts.map((x) => [Number(x.post.location_lat), Number(x.post.location_lng)] as [number, number])}
                      disabled={mapHasInteracted}
                      token={mapFitToken}
                    />
                    <SepbookMapViewport onBoundsChange={setMapBounds} />
                    <SepbookMapUserActivity onActivity={() => setMapHasInteracted(true)} />
                    {mapPosts.map((x) => (
                      <Marker
                        key={x.post.id}
                        position={[Number(x.post.location_lat), Number(x.post.location_lng)]}
                        icon={mapSelectedId === x.post.id ? selectedMarkerIcon : defaultMarkerIcon}
                        eventHandlers={{
                          click: () => handleMapSelection(x.post.id, { openOnSecond: true }),
                        }}
                      >
                      </Marker>
                    ))}
                  </MapContainer>
                  {selectedMapPost ? (
                    <div className="absolute left-3 bottom-3 right-3 z-[1000]">
                      <div className="flex items-center gap-3 rounded-xl border bg-background/90 backdrop-blur px-3 py-2 shadow-lg">
                        {selectedMapPost.imageUrl ? (
                          <button
                            type="button"
                            className="p-0 bg-transparent border-0"
                            onClick={() => handleMapSelection(selectedMapPost.post.id, { openOnSecond: true })}
                            title={tr("sepbook.openPost")}
                          >
                            <img
                              src={selectedMapPost.imageUrl}
                              alt={tr("sepbook.photo")}
                              className="h-12 w-12 rounded-lg object-cover border"
                            />
                          </button>
                        ) : (
                          <div className="h-12 w-12 rounded-lg border bg-muted" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <UserProfilePopover
                              userId={selectedMapPost.post.user_id}
                              name={selectedMapPost.post.author_name}
                              avatarUrl={selectedMapPost.post.author_avatar}
                            >
                              <button type="button" className="text-[13px] font-semibold truncate hover:underline p-0 bg-transparent border-0">
                                {formatName(selectedMapPost.post.author_name)}
                              </button>
                            </UserProfilePopover>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {new Date(selectedMapPost.post.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="text-[12px] text-muted-foreground truncate">
                            {sanitizeLocationLabel(selectedMapPost.post.location_label) || tr("sepbook.location")}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {tr("sepbook.mapHintSelectThenOpen")}
                          </div>
                          {selectedMapLinks ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {isMobileDevice ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => window.open(selectedMapLinks.wazeUrl, "_blank", "noreferrer")}
                                  >
                                    Waze
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => window.open(selectedMapLinks.mapsUrl, "_blank", "noreferrer")}
                                  >
                                    Maps
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => window.open(selectedMapLinks.mapsUrl, "_blank", "noreferrer")}
                                >
                                  Abrir no Maps
                                </Button>
                              )}
                            </div>
                          ) : null}
                        </div>
                        <Button type="button" size="sm" onClick={() => openPostById(selectedMapPost.post.id)}>
                          {tr("sepbook.openPost")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      onClick={() => {
                        setMapHasInteracted(true);
                        mapInstanceRef.current?.zoomIn();
                      }}
                      aria-label={tr("sepbook.zoomIn")}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      onClick={() => {
                        setMapHasInteracted(true);
                        mapInstanceRef.current?.zoomOut();
                      }}
                      aria-label={tr("sepbook.zoomOut")}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="max-h-[48vh] md:max-h-[70vh] overflow-auto p-4 space-y-3">
                {visibleMapPosts.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{tr("sepbook.mapViewportEmpty")}</div>
                ) : (
                  visibleMapPosts.map((x) => (
                    <button
                      key={`gps-${x.post.id}`}
                      type="button"
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl border p-2 hover:bg-muted text-left",
                        mapSelectedId === x.post.id && "border-amber-400/80 bg-amber-100/10",
                      )}
                      onClick={() => handleMapSelection(x.post.id, { openOnSecond: true })}
                    >
                      <img
                        src={x.imageUrl || undefined}
                        alt={tr("sepbook.photo")}
                        className="h-16 w-16 rounded-lg object-cover border"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMapSelection(x.post.id, { openOnSecond: true });
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <UserProfilePopover userId={x.post.user_id} name={x.post.author_name} avatarUrl={x.post.author_avatar}>
                          <button
                            type="button"
                            className="text-[13px] font-semibold truncate hover:underline p-0 bg-transparent border-0 text-left"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {formatName(x.post.author_name)}
                          </button>
                        </UserProfilePopover>
                        <div className="text-[12px] text-muted-foreground truncate">
                          {sanitizeLocationLabel(x.post.location_label) || tr("sepbook.location")}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {new Date(x.post.created_at).toLocaleString()}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={locationConsentDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setLocationConsentDialogOpen(true);
            return;
          }
          setLocationConsentDialogOpen(false);
          locationConsentResolverRef.current?.(false);
          locationConsentResolverRef.current = null;
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("sepbook.gpsConsentTitle")}</DialogTitle>
            <DialogDescription>
              {tr("sepbook.gpsConsentDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLocationConsent("deny");
                writeLocationConsent("deny");
                setLocationConsentDialogOpen(false);
                locationConsentResolverRef.current?.(false);
                locationConsentResolverRef.current = null;
              }}
            >
              {tr("sepbook.gpsConsentDeny")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLocationConsent("allow");
                writeLocationConsent("allow");
                setLocationConsentDialogOpen(false);
                locationConsentResolverRef.current?.(true);
                locationConsentResolverRef.current = null;
              }}
            >
              {tr("sepbook.gpsConsentAllow")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={useDeviceLocationDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setUseDeviceLocationDialogOpen(true);
            return;
          }
          setUseDeviceLocationDialogOpen(false);
          useDeviceLocationResolverRef.current?.(false);
          useDeviceLocationResolverRef.current = null;
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("sepbook.photoNoGpsTitle")}</DialogTitle>
            <DialogDescription>
              {tr("sepbook.photoNoGpsDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setUseDeviceLocationDialogOpen(false);
                useDeviceLocationResolverRef.current?.(false);
                useDeviceLocationResolverRef.current = null;
              }}
            >
              {tr("sepbook.photoNoGpsDeny")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setUseDeviceLocationDialogOpen(false);
                useDeviceLocationResolverRef.current?.(true);
                useDeviceLocationResolverRef.current = null;
              }}
            >
              {tr("sepbook.photoNoGpsAllow")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
