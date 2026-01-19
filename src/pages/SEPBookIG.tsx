import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation as useRouterLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Navigation from "@/components/Navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
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
  RotateCcw,
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
  post_kind?: "normal" | "ocorrencia" | string | null;
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

type SepPostKind = "normal" | "ocorrencia";
type SepPostKindFilter = "all" | SepPostKind;

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
  location_label?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  parent_id?: string | null;
  like_count?: number;
  has_liked?: boolean;
  updated_at?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_at: string;
};

type SepCommentGps = {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string;
  author_team: string | null;
  author_avatar: string | null;
  author_base?: string | null;
  image_url: string;
  location_label: string | null;
  location_lat: number;
  location_lng: number;
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
  file?: File;
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

type SepMapItem = {
  key: string;
  kind: "post" | "comment";
  lat: number;
  lng: number;
  imageUrl: string;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
  created_at: string;
  location_label: string | null;
  post_id: string;
  comment_id: string | null;
};

const randomId = () => Math.random().toString(36).slice(2);

type MapProfile = {
  id: string;
  name: string | null;
  operational_base: string | null;
  sigla_area: string | null;
  phone: string | null;
  telefone?: string | null;
  avatar_url: string | null;
  avatar_thumbnail_url?: string | null;
  sepbook_gps_consent?: boolean | null;
};

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

const cleanPhoneDigits = (raw: any) => {
  const d = String(raw || "").replace(/\D+/g, "");
  return d.length >= 8 ? d : "";
};

const getWhatsAppUrl = (digitsRaw: any) => {
  const digits = cleanPhoneDigits(digitsRaw);
  if (!digits) return null;
  const isMobile =
    typeof navigator !== "undefined" &&
    ("userAgentData" in navigator
      ? Boolean((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile)
      : /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent));
  return isMobile ? `https://wa.me/${digits}` : `https://web.whatsapp.com/send?phone=${digits}`;
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

const isVideoUrl = (url: string) => {
  const u = String(url || "").toLowerCase();
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(u);
};

const normalizeAttachmentUrls = (raw: any): string[] => {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const v = raw.trim();
    if (!v) return [];
    if (v.startsWith("[")) {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed.map((x) => String(x || "").trim()).filter(Boolean);
      } catch {
        // ignore
      }
    }
    return [v];
  }
  return [];
};

const clampLatLng = (lat: number, lng: number) => {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  if (Math.abs(la) < 1e-9 && Math.abs(ln) < 1e-9) return null;
  return { lat: la, lng: ln };
};

const geoKeyFor = (lat: number, lng: number) => `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
const formatLatLng = (lat: number, lng: number) => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;

const sanitizeLocationLabel = (raw: any) => {
  const label = String(raw || "").trim();
  if (!label) return null;
  if (/^local atual$/i.test(label)) return null;
  // Hide raw lat/lng even for older posts that stored coordinates in the label.
  if (/(lat|lng)\s*-?\d{1,2}\.\d+|gps.*-?\d{1,2}\.\d+,\s*-?\d{1,3}\.\d+/i.test(label)) {
    if (/gps da foto/i.test(label)) return "GPS da foto";
    if (/local atual/i.test(label)) return null;
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
  const isMod =
    isAdmin ||
    (Array.isArray(roles) &&
      roles.some((r) => ["admin", "gerente_djt", "gerente_divisao_djtx", "coordenador_djtx"].includes(String(r || ""))));
  const canGiveFeedback = Boolean(isLeader || studioAccess || isAdmin);
  const [myProfile, setMyProfile] = useState<MapProfile | null>(null);

  useEffect(() => {
    const uid = String(user?.id || "").trim();
    if (!uid) {
      setMyProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, name, operational_base, sigla_area, phone, telefone, avatar_url, avatar_thumbnail_url, sepbook_gps_consent")
          .eq("id", uid)
          .maybeSingle();
        if (!cancelled) setMyProfile((data as any) || null);
      } catch {
        if (!cancelled) setMyProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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
  const [filterPostKind, setFilterPostKind] = useState<SepPostKindFilter>("all");
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
  const [commentGpsItems, setCommentGpsItems] = useState<SepCommentGps[]>([]);
  const [commentGpsLoading, setCommentGpsLoading] = useState(false);
  const [mapProfiles, setMapProfiles] = useState<Record<string, MapProfile>>({});
  const isMobileDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }, []);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [composerMentionQuery, setComposerMentionQuery] = useState("");
  const composerMentions = useMentionSuggest(composerMentionQuery);
  const [composerCampaignQuery, setComposerCampaignQuery] = useState("");
  const composerCampaigns = useCampaignSuggest(composerCampaignQuery);
  const [composerCampaignId, setComposerCampaignId] = useState<string | null>(null);
  const [composerCampaignLabel, setComposerCampaignLabel] = useState<string | null>(null);
  const [composerPostKind, setComposerPostKind] = useState<SepPostKind>("normal");
  const [composerMedia, setComposerMedia] = useState<MediaItem[]>([]);
  const [composerUploading, setComposerUploading] = useState(false);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const composerCameraRef = useRef<HTMLInputElement | null>(null);
  const composerGalleryRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostText, setEditingPostText] = useState("");
  const [editingPostMentionQuery, setEditingPostMentionQuery] = useState("");
  const editingPostMentions = useMentionSuggest(editingPostMentionQuery);
  const [editingPostSaving, setEditingPostSaving] = useState(false);
  const [editingPostKind, setEditingPostKind] = useState<SepPostKind>("normal");
  const [editingPostMedia, setEditingPostMedia] = useState<MediaItem[]>([]);
  const [editingPostUploading, setEditingPostUploading] = useState(false);
  const editingPostCameraRef = useRef<HTMLInputElement | null>(null);
  const editingPostGalleryRef = useRef<HTMLInputElement | null>(null);

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
  const commentsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [commentLiking, setCommentLiking] = useState<Record<string, boolean>>({});
  const [commentRestoring, setCommentRestoring] = useState<Record<string, boolean>>({});
  const [replyTarget, setReplyTarget] = useState<SepComment | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [editingCommentMentionQuery, setEditingCommentMentionQuery] = useState("");
  const editingCommentMentions = useMentionSuggest(editingCommentMentionQuery);
  const [editingCommentSaving, setEditingCommentSaving] = useState(false);
  const [cleaningComment, setCleaningComment] = useState(false);
  const [cleaningCommentEdit, setCleaningCommentEdit] = useState(false);
  const [cleaningComposer, setCleaningComposer] = useState(false);
  const [cleaningEditingPost, setCleaningEditingPost] = useState(false);

  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [mentionsItems, setMentionsItems] = useState<any[]>([]);

  const [likesOpenFor, setLikesOpenFor] = useState<string | null>(null);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likers, setLikers] = useState<LikeUser[]>([]);

  const deepLinkCommentTargetRef = useRef<{ commentId: string; postId: string } | null>(null);
  const deepLinkCommentHandledRef = useRef<string | null>(null);
  const deepLinkPostHandledRef = useRef<string | null>(null);
  const sepbookPostMentionReadDoneRef = useRef<Set<string>>(new Set());
  const sepbookPostMentionReadInFlightRef = useRef<Set<string>>(new Set());
  const sepbookBadgeRefreshTimerRef = useRef<number | null>(null);

  const activePost = useMemo(() => posts.find((p) => p.id === commentsOpenFor) || null, [commentsOpenFor, posts]);
  const editingPost = useMemo(() => posts.find((p) => p.id === editingPostId) || null, [editingPostId, posts]);

  const [fallbackTranslations, setFallbackTranslations] = useState<Record<string, string>>({});
  const translationInFlightRef = useRef(0);

  const composerGpsSource = useMemo(() => {
    const items = composerMedia.filter((m) => m.kind === "image");
    for (const it of items) {
      if (it.gps && typeof it.gps.lat === "number" && typeof it.gps.lng === "number") {
        return { gps: it.gps, url: it.url || null, id: it.id };
      }
    }
    return null;
  }, [composerMedia]);

  const commentGpsSource = useMemo(() => {
    const items = commentMedia.filter((m) => m.kind === "image");
    for (const it of items) {
      if (it.gps && typeof it.gps.lat === "number" && typeof it.gps.lng === "number") {
        return { gps: it.gps, url: it.url || null, id: it.id };
      }
    }
    return null;
  }, [commentMedia]);

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

  const normalizePostKind = useCallback((raw: any): SepPostKind => {
    const k = String(raw || "").trim().toLowerCase();
    return k === "ocorrencia" ? "ocorrencia" : "normal";
  }, []);

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
    if (filterPostKind !== "all") {
      items = items.filter((p) => normalizePostKind((p as any)?.post_kind) === filterPostKind);
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
  }, [filterCampaignId, filterMine, filterPostKind, filterUserId, normalizePostKind, posts, sortMode, user?.id]);

  const visiblePostIdsKey = useMemo(() => visiblePosts.map((p) => p.id).slice(0, 80).join(","), [visiblePosts]);

  useEffect(() => {
    if (!mapOpen) return;
    const ids = visiblePosts.map((p) => p.id).slice(0, 80);
    if (!ids.length) {
      setCommentGpsItems([]);
      return;
    }
    let cancelled = false;
    setCommentGpsLoading(true);
    (async () => {
      try {
        const resp = await apiFetch(`/api/sepbook-comment-gps?post_ids=${encodeURIComponent(ids.join(","))}&limit=800`);
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao carregar comentários com GPS");
        if (!cancelled) setCommentGpsItems(Array.isArray(json.items) ? (json.items as any) : []);
      } catch {
        if (!cancelled) setCommentGpsItems([]);
      } finally {
        if (!cancelled) setCommentGpsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapOpen, visiblePostIdsKey]);

  const mapPosts = useMemo(() => {
    const visibleIds = new Set(visiblePosts.map((p) => p.id));

    const postItems: SepMapItem[] = visiblePosts
      .map((p) => {
        const lat = Number(p.location_lat);
        const lng = Number(p.location_lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9) return null;
        const imageUrl = (Array.isArray(p.attachments) ? p.attachments : []).find((u) => isImageUrl(u)) || null;
        if (!imageUrl) return null;
        return {
          key: `post:${p.id}`,
          kind: "post",
          lat,
          lng,
          imageUrl,
          user_id: p.user_id,
          author_name: p.author_name,
          author_avatar: p.author_avatar || null,
          created_at: p.created_at,
          location_label: p.location_label || null,
          post_id: p.id,
          comment_id: null,
        } as SepMapItem;
      })
      .filter(Boolean) as SepMapItem[];

    const commentItems: SepMapItem[] = (commentGpsItems || [])
      .filter((c) => visibleIds.has(String(c.post_id || "")))
      .map((c) => {
        const lat = Number((c as any).location_lat);
        const lng = Number((c as any).location_lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9) return null;
        const imageUrl = String((c as any).image_url || "").trim();
        if (!imageUrl || !isImageUrl(imageUrl)) return null;
        return {
          key: `comment:${c.id}`,
          kind: "comment",
          lat,
          lng,
          imageUrl,
          user_id: c.user_id,
          author_name: c.author_name,
          author_avatar: (c as any).author_avatar || null,
          created_at: c.created_at,
          location_label: (c as any).location_label || null,
          post_id: c.post_id,
          comment_id: c.id,
        } as SepMapItem;
      })
      .filter(Boolean) as SepMapItem[];

    return [...postItems, ...commentItems];
  }, [commentGpsItems, visiblePosts]);

  const mapUserIdsKey = useMemo(() => {
    const ids = mapPosts.map((x) => String(x.user_id || "")).filter(Boolean);
    ids.sort();
    return ids.join(",");
  }, [mapPosts]);

  useEffect(() => {
    if (!mapOpen) return;
    const ids = Array.from(new Set(mapPosts.map((x) => x.user_id).filter(Boolean))).slice(0, 140);
    if (!ids.length) {
      setMapProfiles({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, name, operational_base, sigla_area, phone, telefone, avatar_url, avatar_thumbnail_url, sepbook_gps_consent")
          .in("id", ids);
        if (cancelled) return;
        const next: Record<string, MapProfile> = {};
        (Array.isArray(data) ? data : []).forEach((p: any) => {
          if (!p?.id) return;
          next[String(p.id)] = p as any;
        });
        setMapProfiles(next);
      } catch {
        if (!cancelled) setMapProfiles({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapOpen, mapUserIdsKey]);

  const visibleMapPosts = useMemo(() => {
    if (!mapBounds) return mapPosts;
    return mapPosts.filter((x) => {
      if (!Number.isFinite(x.lat) || !Number.isFinite(x.lng)) return false;
      return mapBounds.contains(L.latLng(x.lat, x.lng));
    });
  }, [mapBounds, mapPosts]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (!mapPosts.length) return [-23.55052, -46.633308]; // fallback: São Paulo
    const sum = mapPosts.reduce(
      (acc, item) => {
        acc.lat += Number(item.lat || 0);
        acc.lng += Number(item.lng || 0);
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
    void apiFetch("/api/sepbook-mentions-mark-seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: id }),
    })
      .then(() => window.dispatchEvent(new CustomEvent("djt-refresh-badges")))
      .catch(() => {});
    window.setTimeout(() => {
      const el = document.getElementById(`post-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, []);

  const openCommentById = useCallback(
    (postId: string, commentId: string) => {
      const pid = String(postId || "").trim();
      const cid = String(commentId || "").trim();
      if (!pid || !cid) return;
      setMapOpen(false);
      setAuthorPickerOpen(false);
      void apiFetch("/api/sepbook-mentions-mark-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: pid, comment_id: cid }),
      })
        .then(() => window.dispatchEvent(new CustomEvent("djt-refresh-badges")))
        .catch(() => {});
      navigate(`/sepbook?comment=${encodeURIComponent(cid)}#post-${encodeURIComponent(pid)}`);
    },
    [navigate],
  );

  const selectedMapPost = useMemo(() => {
    if (!mapSelectedId) return null;
    return mapPosts.find((x) => x.key === mapSelectedId) || null;
  }, [mapPosts, mapSelectedId]);

  const selectedMapProfile = useMemo(() => {
    if (!selectedMapPost) return null;
    return mapProfiles[String(selectedMapPost.user_id || "")] || null;
  }, [mapProfiles, selectedMapPost]);

  const selectedMapPhoneDigits = useMemo(() => {
    if (!selectedMapProfile) return "";
    return cleanPhoneDigits(selectedMapProfile.phone || selectedMapProfile.telefone);
  }, [selectedMapProfile]);

  const selectedMapTelUrl = useMemo(() => (selectedMapPhoneDigits ? `tel:${selectedMapPhoneDigits}` : null), [selectedMapPhoneDigits]);

  const selectedMapWhatsAppUrl = useMemo(() => getWhatsAppUrl(selectedMapPhoneDigits), [selectedMapPhoneDigits]);

  const selectedMapLinks = useMemo(() => {
    if (!selectedMapPost) return null;
    const lat = Number(selectedMapPost.lat);
    const lng = Number(selectedMapPost.lng);
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
    (itemKey: string, opts?: { openPost?: boolean }) => {
      const key = String(itemKey || "").trim();
      if (!key) return;
      setMapSelectedId(key);
      const target = mapPosts.find((x) => x.key === key);
      if (target && mapInstanceRef.current) {
        const lat = Number(target.lat);
        const lng = Number(target.lng);
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
        if (!target) return;
        if (target.kind === "comment" && target.comment_id) {
          openCommentById(target.post_id, target.comment_id);
        } else {
          openPostById(target.post_id);
        }
      }
    },
    [mapPosts, openCommentById, openPostById],
  );

  const handleMapSelection = useCallback(
    (itemKey: string, opts?: { openOnSecond?: boolean; openPost?: boolean }) => {
      const key = String(itemKey || "").trim();
      if (!key) return;
      setMapHasInteracted(true);
      const isSelected = mapSelectedId === key;
      if (!isSelected) {
        focusMapPost(key);
        return;
      }
      if (opts?.openPost || opts?.openOnSecond) {
        focusMapPost(key, { openPost: true });
      } else {
        focusMapPost(key);
      }
    },
    [focusMapPost, mapSelectedId],
  );

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

  const resolveLocationForNewPost = useCallback(async () => {
    if (myProfile?.sepbook_gps_consent !== true) return null;

    // Prefer EXIF GPS from the image, if present.
    if (composerGpsSource?.gps && composerGpsSource.url) {
      return {
        location_lat: composerGpsSource.gps.lat,
        location_lng: composerGpsSource.gps.lng,
        // The backend will reverse-geocode (city/state) from lat/lng; never use operational_base as "location".
        location_label: null,
        __gps_url: composerGpsSource.url || null,
      };
    }
    return null;
  }, [composerGpsSource, myProfile?.sepbook_gps_consent]);

  const resolveLocationForNewComment = useCallback(async () => {
    if (!commentGpsSource?.gps || !commentGpsSource.url) return null;
    if (myProfile?.sepbook_gps_consent !== true) return null;
    return {
      location_lat: commentGpsSource.gps.lat,
      location_lng: commentGpsSource.gps.lng,
      // The backend will reverse-geocode (city/state) from lat/lng; never use operational_base as "location".
      location_label: null,
      __gps_url: commentGpsSource.url || null,
    };
  }, [commentGpsSource, myProfile?.sepbook_gps_consent]);

  const geoLabelCacheRef = useRef<Record<string, string>>({});
  const geoInFlightRef = useRef<Set<string>>(new Set());
  const [geoLabels, setGeoLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    geoLabelCacheRef.current = geoLabels;
  }, [geoLabels]);

  const fetchGeoLabel = useCallback(async (latRaw: any, lngRaw: any) => {
    const coords = clampLatLng(Number(latRaw), Number(lngRaw));
    if (!coords) return;
    const key = geoKeyFor(coords.lat, coords.lng);
    if (geoLabelCacheRef.current[key]) return;
    if (geoInFlightRef.current.has(key)) return;
    geoInFlightRef.current.add(key);
    try {
      const resp = await apiFetch(`/api/reverse-geocode?lat=${encodeURIComponent(String(coords.lat))}&lng=${encodeURIComponent(String(coords.lng))}`);
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && typeof json?.label === "string" && json.label.trim()) {
        const label = String(json.label).trim();
        setGeoLabels((prev) => (prev[key] ? prev : { ...prev, [key]: label }));
      }
    } catch {
      /* ignore */
    } finally {
      geoInFlightRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    // Preload reverse-geocoded labels for visible posts with GPS.
    const targets = visiblePosts.slice(0, 40).map((p) => {
      const coords = clampLatLng(Number(p.location_lat), Number(p.location_lng));
      if (!coords) return null;
      const safe = sanitizeLocationLabel(p.location_label);
      const authorBase = String((p as any)?.author_base || "").trim().toLowerCase();
      const treatAsMissing = !safe || (authorBase && safe.toLowerCase() === authorBase);
      if (!treatAsMissing) return null;
      const key = geoKeyFor(coords.lat, coords.lng);
      if (geoLabelCacheRef.current[key]) return null;
      if (geoInFlightRef.current.has(key)) return null;
      return { lat: coords.lat, lng: coords.lng };
    }).filter(Boolean) as Array<{ lat: number; lng: number }>;

    if (!targets.length) return;
    let cancelled = false;
    (async () => {
      for (const t of targets) {
        if (cancelled) return;
        await fetchGeoLabel(t.lat, t.lng);
        await new Promise((r) => setTimeout(r, 80));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchGeoLabel, visiblePosts]);

  const uploadedComposerUrls = useMemo(
    () => composerMedia.filter((m) => m.url).map((m) => m.url!) as string[],
    [composerMedia],
  );
  const uploadedCommentUrls = useMemo(
    () => commentMedia.filter((m) => m.url).map((m) => m.url!) as string[],
    [commentMedia],
  );

  const orderUrlsWithGpsFirst = useCallback((urls: string[], gpsUrl: string | null) => {
    const list = (urls || []).filter(Boolean);
    const target = String(gpsUrl || "").trim();
    if (!target) return list;
    if (!list.includes(target)) return list;
    return [target, ...list.filter((u) => u !== target)];
  }, []);

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
      try {
        if (typeof document !== "undefined") {
          const el = document.activeElement;
          commentsReturnFocusRef.current = el instanceof HTMLElement ? el : null;
          commentsReturnFocusRef.current?.blur?.();
        }
      } catch {
        // ignore
      }
      setCommentsOpenFor(id);
      setCommentText("");
      setCommentMentionQuery("");
      setReplyTarget(null);
      setEditingCommentId(null);
      setEditingCommentText("");
      commentMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
      setCommentMedia([]);
      void apiFetch("/api/sepbook-mentions-mark-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: id, include_comments: true }),
      })
        .then(() => window.dispatchEvent(new CustomEvent("djt-refresh-badges")))
        .catch(() => {});
      if (!commentsByPost[id]) void loadComments(id);
      requestAnimationFrame(() => commentInputRef.current?.focus());
      window.setTimeout(() => {
        commentInputRef.current?.focus();
      }, 120);
    },
    [commentMedia, commentsByPost, loadComments],
  );

  useEffect(() => {
    if (!composerOpen) return;
    const t = window.setTimeout(() => {
      composerInputRef.current?.focus();
    }, 120);
    return () => window.clearTimeout(t);
  }, [composerOpen]);

  // Mobile UX: when the composer drawer is open, collapse bottom navigation
  // so actions (camera/gallery/publish) are never hidden behind the bar.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("djt-nav-visibility", { detail: { hidden: Boolean(composerOpen) } }));
    return () => window.dispatchEvent(new CustomEvent("djt-nav-visibility", { detail: { hidden: false } }));
  }, [composerOpen]);

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

  const closeEditPost = useCallback(
    (opts?: { cleanupUploads?: boolean }) => {
      const cleanupUploads = opts?.cleanupUploads !== false;
      const toRemove = cleanupUploads
        ? editingPostMedia
            .filter((m) => m.bucket && m.filePath)
            .map((m) => ({ bucket: m.bucket as string, filePath: m.filePath as string }))
        : [];

      for (const it of editingPostMedia) {
        const u = String(it.previewUrl || "");
        if (!u || !u.startsWith("blob:")) continue;
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }

      setEditingPostId(null);
      setEditingPostText("");
      setEditingPostMentionQuery("");
      setEditingPostKind("normal");
      setEditingPostMedia([]);
      setEditingPostUploading(false);

      if (cleanupUploads && toRemove.length) {
        void (async () => {
          for (const item of toRemove) {
            try {
              await supabase.storage.from(item.bucket).remove([item.filePath]);
            } catch {
              /* ignore */
            }
          }
        })();
      }
    },
    [editingPostMedia],
  );

  const startEditPost = useCallback(
    (post: SepPost) => {
      setEditingPostId(post.id);
      setEditingPostText(String(post.content_md || ""));
      setEditingPostKind(normalizePostKind((post as any)?.post_kind));
      setEditingPostUploading(false);
      const urls = normalizeAttachmentUrls((post as any).attachments);
      setEditingPostMedia(
        urls
          .map((u) => String(u || "").trim())
          .filter(Boolean)
          .map((url) => ({
            id: randomId(),
            kind: isVideoUrl(url) ? "video" : "image",
            previewUrl: url,
            uploading: false,
            progress: 100,
            url,
          })),
      );
    },
    [normalizePostKind, setEditingPostMedia],
  );

  const cancelEditPost = useCallback(() => {
    closeEditPost({ cleanupUploads: true });
  }, [closeEditPost]);

  const savePostEdit = useCallback(async () => {
    if (!editingPostId || !editingPost) return;
    const text = String(editingPostText || "").trim();
    const attachments = (editingPostMedia || [])
      .map((m) => String(m?.url || "").trim())
      .filter(Boolean);
    const hasAttachments = attachments.length > 0;
    const uploading = Boolean(editingPostUploading || editingPostMedia.some((m) => m.uploading));
    if (uploading) {
      toast({ title: "Aguarde", description: "Finalize o upload da mídia antes de salvar.", variant: "destructive" });
      return;
    }
    if (!text && !hasAttachments) {
      toast({ title: "Conteúdo obrigatório", description: "Digite um texto ou mantenha uma mídia.", variant: "destructive" });
      return;
    }

    setEditingPostSaving(true);
    try {
      const resp = await apiFetch("/api/sepbook-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_id: editingPostId,
          content_md: text,
          attachments,
          post_kind: editingPostKind,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao atualizar publicação");

      const updated = json?.post && typeof json.post === "object" ? json.post : null;
      const nextTranslations =
        updated?.translations && typeof updated.translations === "object"
          ? updated.translations
          : { ...(editingPost.translations || {}), [locale]: text };

      setPosts((prev) =>
        prev.map((p) =>
          p.id === editingPostId
            ? {
                ...p,
                content_md: text,
                attachments,
                post_kind: editingPostKind,
                translations: nextTranslations,
              }
            : p,
        ),
      );
      setFallbackTranslations((prev) => ({ ...prev, [`post:${editingPostId}`]: text }));
      closeEditPost({ cleanupUploads: false });
      toast({ title: "Publicação atualizada" });
    } catch (e: any) {
      toast({ title: "Erro ao editar", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setEditingPostSaving(false);
    }
  }, [closeEditPost, editingPost, editingPostId, editingPostKind, editingPostMedia, editingPostText, editingPostUploading, locale, toast]);

  const clearEditingPostMedia = useCallback(() => {
    const toRemove = (editingPostMedia || [])
      .filter((m) => m.bucket && m.filePath)
      .map((m) => ({ bucket: m.bucket as string, filePath: m.filePath as string }));

    for (const it of editingPostMedia || []) {
      const u = String(it.previewUrl || "");
      if (!u || !u.startsWith("blob:")) continue;
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }

    setEditingPostMedia([]);

    if (toRemove.length) {
      void (async () => {
        for (const item of toRemove) {
          try {
            await supabase.storage.from(item.bucket).remove([item.filePath]);
          } catch {
            /* ignore */
          }
        }
      })();
    }
  }, [editingPostMedia]);

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
              {editingCommentMentionQuery && editingCommentMentions.items.length > 0 && (
                <div className="rounded-xl border bg-background">
                  <div className="px-3 py-2 text-[12px] text-muted-foreground">{tr("sepbook.mentionSuggestions")}</div>
                  <div className="max-h-[160px] overflow-auto">
                    {editingCommentMentions.items.slice(0, 8).map((s, idx) => (
                        <button
                          key={`edit-${s.kind}-${s.handle}-${idx}`}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-muted text-[13px]"
                          onClick={() => setEditingCommentText((prev) => applyMention(prev, editingCommentMentionQuery, s.handle))}
                        >
                          <span className="font-semibold">@{s.handle}</span>{" "}
                          <span className="text-muted-foreground">
                            {s.label}
                            {String((s as any)?.kind || "") === "team" ? " (equipe)" : ""}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
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
                <div className="mt-0.5 space-y-1">
                  <div className="text-[13px] italic text-muted-foreground">Comentário removido</div>
                  {isOwn && comment.deleted_at ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void restoreComment(postId, comment)}
                      disabled={commentRestoring[comment.id]}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Restaurar
                    </Button>
                  ) : null}
                </div>
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
      context: "post" | "comment" | "edit-post";
      source: "camera" | "gallery";
    }) => {
      const list = opts.files ? Array.from(opts.files) : [];
      if (!list.length) return;

      const isComposerPost = opts.context === "post";
      const isEditPost = opts.context === "edit-post";
      const isPost = isComposerPost || isEditPost;
      const maxFiles = isPost ? 5 : 3;
      const maxImages = isPost ? 3 : 3;
      const maxVideos = isPost ? 2 : 0;
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

      const setState = isComposerPost ? setComposerMedia : opts.context === "comment" ? setCommentMedia : setEditingPostMedia;
      const current = isComposerPost ? composerMedia : opts.context === "comment" ? commentMedia : editingPostMedia;
      const setUploading = isComposerPost
        ? setComposerUploading
        : opts.context === "comment"
          ? setCommentUploading
          : setEditingPostUploading;

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
        const gps = kind === "image" ? await extractGpsFromImage(file) : null;
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
        } else if (opts.context === "comment") {
          if (opts.source === "camera" && commentCameraRef.current) commentCameraRef.current.value = "";
          if (opts.source === "gallery" && commentGalleryRef.current) commentGalleryRef.current.value = "";
        } else {
          if (opts.source === "camera" && editingPostCameraRef.current) editingPostCameraRef.current.value = "";
          if (opts.source === "gallery" && editingPostGalleryRef.current) editingPostGalleryRef.current.value = "";
        }
      } catch {
        /* ignore */
      }
    },
    [commentMedia, composerMedia, editingPostMedia, toast],
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

  const handleCleanupEditingPost = useCallback(async () => {
    if (cleaningEditingPost) return;
    setCleaningEditingPost(true);
    try {
      const result = await runCleanup({ text: editingPostText, title: "Edição SEPBook" });
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
      setEditingPostText(result.cleaned);
      toast({ title: "Texto revisado", description: "Ortografia e pontuação ajustadas." });
    } catch (e: any) {
      toast({ title: "Não foi possível revisar", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setCleaningEditingPost(false);
    }
  }, [cleaningEditingPost, editingPostText, runCleanup, toast]);

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
          translations: { ...(comment.translations || {}), [locale]: text },
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
    [cancelEditComment, editingCommentText, locale, toast],
  );

  const deleteComment = useCallback(
    async (postId: string, comment: SepComment) => {
      if (!confirm("Excluir este comentário?")) return;
      try {
        const resp = await apiFetch(`/api/sepbook-comments?comment_id=${encodeURIComponent(comment.id)}`, { method: "DELETE" });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao excluir comentário");

        const mode = String(json?.deleted || "");
        if (mode.startsWith("soft")) {
          const nowIso = new Date().toISOString();
          setCommentsByPost((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map((c) =>
              c.id === comment.id
                ? {
                    ...c,
                    content_md: "",
                    attachments: [],
                    like_count: 0,
                    has_liked: false,
                    updated_at: nowIso,
                    deleted_at: nowIso,
                    deleted_by: user?.id || null,
                  }
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
    [cancelEditComment, editingCommentId, toast, user?.id],
  );

  const restoreComment = useCallback(
    async (postId: string, comment: SepComment) => {
      const cid = String(comment?.id || "").trim();
      if (!cid) return;
      if (commentRestoring[cid]) return;
      setCommentRestoring((prev) => ({ ...prev, [cid]: true }));
      try {
        const resp = await apiFetch("/api/sepbook-comments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment_id: cid, restore: true }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao restaurar comentário");
        const restored = json?.comment || null;
        setCommentsByPost((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((c) => (c.id === cid ? { ...c, ...(restored || {}), deleted_at: null, deleted_by: null } : c)),
        }));
        toast({ title: "Comentário restaurado" });
      } catch (e: any) {
        toast({ title: "Erro ao restaurar", description: e?.message || "Tente novamente", variant: "destructive" });
      } finally {
        setCommentRestoring((prev) => ({ ...prev, [cid]: false }));
      }
    },
    [commentRestoring, toast],
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
      const gpsUrl = locationPayload && typeof (locationPayload as any).__gps_url === "string" ? String((locationPayload as any).__gps_url) : null;
      const { __gps_url: _omit, ...locationFields } = (locationPayload as any) || {};
      const orderedAttachments = orderUrlsWithGpsFirst(uploadedComposerUrls, gpsUrl);
      const resp = await apiFetch("/api/sepbook-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_md: text,
          attachments: orderedAttachments,
          post_kind: composerPostKind,
          campaign_id: composerCampaignId || null,
          ...(locationFields || {}),
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
      setComposerPostKind("normal");
      composerMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
      setComposerMedia([]);
      toast({ title: "Publicado", description: "Sua postagem foi publicada no SEPBook." });
    } catch (e: any) {
      toast({ title: "Publicação", description: e?.message || "Falha ao publicar", variant: "destructive" });
    } finally {
      setComposerSubmitting(false);
    }
  }, [
    composerCampaignId,
    composerMedia,
    composerPostKind,
    composerText,
    composerUploading,
    orderUrlsWithGpsFirst,
    resolveLocationForNewPost,
    toast,
    uploadedComposerUrls,
  ]);

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
      const locationPayload = await resolveLocationForNewComment();
      const gpsUrl = locationPayload && typeof (locationPayload as any).__gps_url === "string" ? String((locationPayload as any).__gps_url) : null;
      const { __gps_url: _omit, ...locationFields } = (locationPayload as any) || {};
      const orderedAttachments = orderUrlsWithGpsFirst(uploadedCommentUrls, gpsUrl);
      const resp = await apiFetch("/api/sepbook-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_id: postId,
          content_md: text,
          attachments: orderedAttachments,
          parent_id: replyTarget?.id || null,
          ...(locationFields || {}),
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
  }, [
    commentMedia,
    commentText,
    commentUploading,
    commentsOpenFor,
    orderUrlsWithGpsFirst,
    replyTarget,
    resolveLocationForNewComment,
    toast,
    uploadedCommentUrls,
  ]);

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
    void loadMentionsInbox();
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

  // Mark unread @mentions as read when the mentioned post becomes visible in the feed.
  // (Comment-mentions are cleared when the user opens the comments drawer.)
  useEffect(() => {
    const uid = String(user?.id || "").trim();
    if (!uid) return;
    if (!posts.length) return;

    let cancelled = false;
    let observer: IntersectionObserver | null = null;

    const scheduleBadgeRefresh = () => {
      if (sepbookBadgeRefreshTimerRef.current) window.clearTimeout(sepbookBadgeRefreshTimerRef.current);
      sepbookBadgeRefreshTimerRef.current = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("djt-refresh-badges"));
      }, 450);
    };

    const markPostMentionRead = async (postId: string) => {
      const pid = String(postId || "").trim();
      if (!pid) return;
      if (sepbookPostMentionReadDoneRef.current.has(pid)) return;
      if (sepbookPostMentionReadInFlightRef.current.has(pid)) return;
      sepbookPostMentionReadInFlightRef.current.add(pid);
      try {
        await apiFetch("/api/sepbook-mentions-mark-seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ post_id: pid }),
        });
        sepbookPostMentionReadDoneRef.current.add(pid);
        scheduleBadgeRefresh();
      } catch {
        // ignore
      } finally {
        sepbookPostMentionReadInFlightRef.current.delete(pid);
      }
    };

    const run = async () => {
      const postIds = posts.map((p) => String(p?.id || "").trim()).filter(Boolean);
      if (!postIds.length) return;

      const unreadMentionPostIds = new Set<string>();
      const chunkSize = 50;
      for (let i = 0; i < postIds.length; i += chunkSize) {
        if (cancelled) return;
        const chunk = postIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("sepbook_mentions")
          .select("post_id")
          .eq("mentioned_user_id", uid)
          .eq("is_read", false)
          .in("post_id", chunk);
        if (!error) {
          (data || []).forEach((r: any) => r?.post_id && unreadMentionPostIds.add(String(r.post_id)));
        }
      }

      if (cancelled) return;
      if (!unreadMentionPostIds.size) return;

      if (typeof IntersectionObserver === "undefined") {
        await Promise.all(Array.from(unreadMentionPostIds).map((pid) => markPostMentionRead(pid)));
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target as HTMLElement;
            const rawId = String(el?.id || "");
            const m = /^post-(.+)$/.exec(rawId);
            const pid = m?.[1] ? String(m[1]) : "";
            if (!pid) return;
            if (!unreadMentionPostIds.has(pid)) return;
            void markPostMentionRead(pid);
          });
        },
        { root: null, threshold: 0.35 },
      );

      unreadMentionPostIds.forEach((pid) => {
        const el = document.getElementById(`post-${pid}`);
        if (el) observer?.observe(el);
      });
    };

    void run();

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      observer = null;
      if (sepbookBadgeRefreshTimerRef.current) window.clearTimeout(sepbookBadgeRefreshTimerRef.current);
      sepbookBadgeRefreshTimerRef.current = null;
    };
  }, [posts, user?.id]);

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
  useEffect(() => {
    setEditingCommentMentionQuery(detectMentionQuery(editingCommentText));
  }, [editingCommentText]);
  useEffect(() => {
    setEditingPostMentionQuery(detectMentionQuery(editingPostText));
  }, [editingPostText]);

  const renderMediaThumbs = (
    items: MediaItem[],
    onRemove: (item: MediaItem) => void,
    opts?: { wrap?: boolean },
  ) => {
    if (!items.length) return null;
    const wrap = opts?.wrap !== false;
    return (
      <div className={cn("flex gap-2", wrap ? "flex-wrap" : "flex-nowrap overflow-x-auto pb-1")}>
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
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{tr("sepbook.postKindLabel")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={filterPostKind} onValueChange={(v) => setFilterPostKind(v as any)}>
                  <DropdownMenuRadioItem value="all">{tr("sepbook.postKindAll")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="normal">{tr("sepbook.postKindNormal")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="ocorrencia">{tr("sepbook.postKindOccurrence")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                {(filterUserId || filterMine || filterCampaignId || filterPostKind !== "all") && (
                  <DropdownMenuItem
                    onClick={() => {
                      setFilterMine(false);
                      setFilterUserId(null);
                      setFilterCampaignId(null);
                      setFilterPostKind("all");
                    }}
                  >
                    {tr("sepbook.clearFilters")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => {
                setComposerPostKind("normal");
                setComposerOpen(true);
              }}
              aria-label={tr("sepbook.newPost")}
            >
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
              const kind = normalizePostKind((p as any)?.post_kind);
              const safeLocationLabel = sanitizeLocationLabel(p.location_label);
              const hasGps = Number.isFinite(Number(p.location_lat)) && Number.isFinite(Number(p.location_lng));
              const coords = hasGps ? clampLatLng(Number(p.location_lat), Number(p.location_lng)) : null;
              const authorBase = String((p as any)?.author_base || "").trim().toLowerCase();
              const labelLooksLikeBase = safeLocationLabel && authorBase && safeLocationLabel.toLowerCase() === authorBase;
              const geoKey = coords ? geoKeyFor(coords.lat, coords.lng) : null;
              const geoLabel = geoKey ? geoLabelCacheRef.current[geoKey] || null : null;
              const locationCity = coords ? (labelLooksLikeBase || !safeLocationLabel ? geoLabel : safeLocationLabel) : null;
              const locationCoords = coords ? formatLatLng(coords.lat, coords.lng) : null;
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
                        {hasGps ? (
                          <button
                            type="button"
                            className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline truncate"
                            onClick={() => {
                              setMapSelectedId(`post:${p.id}`);
                              setMapHasInteracted(false);
                              setMapFitToken((v) => v + 1);
                              setMapOpen(true);
                            }}
                            title={tr("sepbook.map")}
                          >
                            <MapPinned className="h-3.5 w-3.5" />
                            {locationCity ? <span className="truncate">{locationCity}</span> : null}
                            {locationCoords ? <span className="opacity-70 truncate">{locationCity ? `• ${locationCoords}` : locationCoords}</span> : null}
                          </button>
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
                        {p.user_id === user?.id || isMod ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => startEditPost(p)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              {tr("sepbook.edit")}
                            </DropdownMenuItem>
                            {p.user_id === user?.id ? (
                              <DropdownMenuItem onClick={() => void deletePost(p)}>
                                <Trash2 className="h-4 w-4 mr-2" />
                                Excluir publicação
                              </DropdownMenuItem>
                            ) : null}
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

                    <div className="text-[11px] text-muted-foreground">
                      {createdLabel}
                      {kind === "ocorrencia" ? ` • ${tr("sepbook.postKindOccurrence")}` : ""}
                    </div>
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
            setComposerPostKind("normal");
            composerMedia.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
            setComposerMedia([]);
            setComposerUploading(false);
            setComposerSubmitting(false);
          } else {
            setComposerOpen(true);
          }
        }}
      >
        <DrawerContent className="h-[92dvh] max-h-[92dvh] sm:h-auto">
          <DrawerHeader>
            <DrawerTitle>{tr("sepbook.newPost")}</DrawerTitle>
            <DrawerDescription className="sr-only">Criar uma nova postagem, com menções e campanha opcional</DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-3 pb-3 [-webkit-overflow-scrolling:touch]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/20 px-3 py-2">
                  <div className="text-[12px] text-muted-foreground">{tr("sepbook.postKindLabel")}</div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={composerPostKind === "normal" ? "default" : "outline"}
                      onClick={() => setComposerPostKind("normal")}
                    >
                      {tr("sepbook.postKindNormal")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={composerPostKind === "ocorrencia" ? "default" : "outline"}
                      onClick={() => setComposerPostKind("ocorrencia")}
                    >
                      {tr("sepbook.postKindOccurrence")}
                    </Button>
                  </div>
                </div>

                {renderMediaThumbs(composerMedia, (m) => removeMediaItem(m, setComposerMedia))}

                <Textarea
                  ref={composerInputRef}
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  placeholder={tr("sepbook.captionPlaceholder")}
                  className="min-h-[140px]"
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
                          <span className="font-semibold">@{s.handle}</span>{" "}
                          <span className="text-muted-foreground">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t bg-background px-3 py-3 space-y-2 pb-[calc(env(safe-area-inset-bottom)+12px)]">
              {composerUploading || composerMedia.some((m) => m.uploading) ? (
                <div className="text-[12px] text-muted-foreground">
                  Enviando mídias... aguarde para publicar.
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <VoiceRecorderButton
                  size="sm"
                  label={tr("sepbook.voice")}
                  onText={(text) => setComposerText((prev) => [prev, text].filter(Boolean).join("\n\n"))}
                />
                <Button type="button" size="sm" variant="outline" onClick={handleCleanupComposer} disabled={cleaningComposer}>
                  <Wand2 className="h-4 w-4 mr-1" />
                  {tr("sepbook.cleanup")}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
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
                  className="w-full sm:w-auto"
                  disabled={
                    composerSubmitting ||
                    composerUploading ||
                    composerMedia.some((m) => m.uploading) ||
                    (!composerText.trim() && uploadedComposerUrls.length === 0)
                  }
                >
                  {composerSubmitting ? "Publicando..." : tr("sepbook.publish")}
                </Button>
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={Boolean(editingPostId)}
        onOpenChange={(open) => {
          if (!open) cancelEditPost();
        }}
      >
      <DrawerContent className="h-[92dvh] max-h-[92dvh] sm:h-auto">
          <DrawerHeader>
            <DrawerTitle>{tr("sepbook.edit")} </DrawerTitle>
            <DrawerDescription className="sr-only">Editar texto, mídia e menções da publicação</DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-3 pb-3 [-webkit-overflow-scrolling:touch]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/20 px-3 py-2">
                  <div className="text-[12px] text-muted-foreground">{tr("sepbook.postKindLabel")}</div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={editingPostKind === "normal" ? "default" : "outline"}
                      onClick={() => setEditingPostKind("normal")}
                      disabled={editingPostSaving}
                    >
                      {tr("sepbook.postKindNormal")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={editingPostKind === "ocorrencia" ? "default" : "outline"}
                      onClick={() => setEditingPostKind("ocorrencia")}
                      disabled={editingPostSaving}
                    >
                      {tr("sepbook.postKindOccurrence")}
                    </Button>
                  </div>
                </div>

                <Textarea
                  value={editingPostText}
                  onChange={(e) => setEditingPostText(e.target.value)}
                  placeholder={tr("sepbook.captionPlaceholder")}
                  className="min-h-[140px]"
                />

                {editingPostMentionQuery && editingPostMentions.items.length > 0 && (
                  <div className="rounded-xl border bg-background">
                    <div className="px-3 py-2 text-[12px] text-muted-foreground">{tr("sepbook.mentionSuggestions")}</div>
                    <div className="max-h-[220px] overflow-auto">
                      {editingPostMentions.items.slice(0, 12).map((s, idx) => (
                        <button
                          key={`editpost-${s.kind}-${s.handle}-${idx}`}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-muted text-[13px]"
                          onClick={() => setEditingPostText((prev) => applyMention(prev, editingPostMentionQuery, s.handle))}
                        >
                          <span className="font-semibold">@{s.handle}</span>{" "}
                          <span className="text-muted-foreground">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t bg-background px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
              {editingPostUploading || editingPostMedia.some((m) => m.uploading) ? (
                <div className="text-[12px] text-muted-foreground">
                  Enviando mídias... aguarde para salvar.
                </div>
              ) : null}

              {renderMediaThumbs(editingPostMedia, (m) => removeMediaItem(m, setEditingPostMedia), { wrap: false })}

              <div className="flex flex-wrap items-center gap-2">
                <VoiceRecorderButton
                  size="sm"
                  label={tr("sepbook.voice")}
                  onText={(text) => setEditingPostText((prev) => [prev, text].filter(Boolean).join("\n\n"))}
                />
                <Button type="button" size="sm" variant="outline" onClick={handleCleanupEditingPost} disabled={cleaningEditingPost}>
                  <Wand2 className="h-4 w-4 mr-1" />
                  {tr("sepbook.cleanup")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={clearEditingPostMedia} disabled={editingPostSaving || editingPostUploading}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Limpar mídias
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => editingPostCameraRef.current?.click()}
                  disabled={editingPostSaving || editingPostUploading}
                  aria-label={tr("sepbook.camera")}
                  title={tr("sepbook.camera")}
                >
                  <Camera className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => editingPostGalleryRef.current?.click()}
                  disabled={editingPostSaving || editingPostUploading}
                  aria-label={tr("sepbook.gallery")}
                  title={tr("sepbook.gallery")}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>

                <input
                  ref={editingPostCameraRef}
                  type="file"
                  accept="image/*,video/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void addMediaFiles({ files: e.target.files, context: "edit-post", source: "camera" })}
                />
                <input
                  ref={editingPostGalleryRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void addMediaFiles({ files: e.target.files, context: "edit-post", source: "gallery" })}
                />

                <div className="flex-1" />

                <Button type="button" variant="outline" onClick={cancelEditPost} disabled={editingPostSaving}>
                  {tr("sepbook.cancel")}
                </Button>
                <Button
                  type="button"
                  onClick={() => void savePostEdit()}
                  disabled={editingPostSaving || editingPostUploading || editingPostMedia.some((m) => m.uploading)}
                >
                  {editingPostSaving ? tr("common.loading") : tr("sepbook.save")}
                </Button>
              </div>
            </div>
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
            const el = commentsReturnFocusRef.current;
            commentsReturnFocusRef.current = null;
            requestAnimationFrame(() => el?.focus?.());
          }
        }}
      >
        <DrawerContent className="h-[92dvh] max-h-[92dvh] sm:h-auto">
          <DrawerHeader>
            <DrawerTitle>
              {activePost
                ? tr("sepbook.commentsTitleWithAuthor", { author: formatName(activePost.author_name) })
                : tr("sepbook.commentsTitle")}
            </DrawerTitle>
            <DrawerDescription className="sr-only">Lista de comentários e caixa para responder</DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-3 pb-3 [-webkit-overflow-scrolling:touch]">
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
            </div>

            <div className="border-t bg-background px-3 py-3 space-y-2 pb-[calc(env(safe-area-inset-bottom)+12px)]">
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
                    {commentMentions.items.slice(0, 8).map((s, idx) => (
                      <button
                        key={`${s.kind}-${s.handle}-${idx}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted text-[13px]"
                        onClick={() => setCommentText((prev) => applyMention(prev, commentMentionQuery, s.handle))}
                      >
                        <span className="font-semibold">@{s.handle}</span>{" "}
                        <span className="text-muted-foreground">
                          {s.label}
                          {String((s as any)?.kind || "") === "team" ? " (equipe)" : ""}
                        </span>
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
                        openCommentById(postId, commentId);
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
                      points={mapPosts.map((x) => [Number(x.lat), Number(x.lng)] as [number, number])}
                      disabled={mapHasInteracted}
                      token={mapFitToken}
                    />
                    <SepbookMapViewport onBoundsChange={setMapBounds} />
                    <SepbookMapUserActivity onActivity={() => setMapHasInteracted(true)} />
                    {mapPosts.map((x) => (
                      <Marker
                        key={x.key}
                        position={[Number(x.lat), Number(x.lng)]}
                        icon={mapSelectedId === x.key ? selectedMarkerIcon : defaultMarkerIcon}
                        eventHandlers={{
                          click: () => handleMapSelection(x.key, { openOnSecond: true }),
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
                            onClick={() => handleMapSelection(selectedMapPost.key, { openOnSecond: true })}
                            title={selectedMapPost.kind === "comment" ? tr("sepbook.openComment") : tr("sepbook.openPost")}
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
                              userId={selectedMapPost.user_id}
                              name={selectedMapPost.author_name}
                              avatarUrl={selectedMapPost.author_avatar}
                            >
                              <button type="button" className="text-[13px] font-semibold truncate hover:underline p-0 bg-transparent border-0">
                                {formatName(selectedMapPost.author_name)}
                              </button>
                            </UserProfilePopover>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {new Date(selectedMapPost.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="text-[12px] text-muted-foreground truncate">
                            {(() => {
                              const coords = clampLatLng(Number(selectedMapPost.location_lat), Number(selectedMapPost.location_lng));
                              const safe = sanitizeLocationLabel(selectedMapPost.location_label);
                              const base = String(selectedMapProfile?.operational_base || "").trim().toLowerCase();
                              const looksLikeBase = safe && base && safe.toLowerCase() === base;
                              const key = coords ? geoKeyFor(coords.lat, coords.lng) : null;
                              const geo = key ? geoLabelCacheRef.current[key] || null : null;
                              const city = coords ? (looksLikeBase || !safe ? geo : safe) : null;
                              const coordLabel = coords ? formatLatLng(coords.lat, coords.lng) : null;
                              const out = [city, coordLabel].filter(Boolean).join(" • ");
                              return out || tr("sepbook.location");
                            })()}
                          </div>
                          {selectedMapProfile?.operational_base ? (
                            <div className="text-[12px] text-muted-foreground truncate">
                              {tr("userPopover.baseLabel")}: {selectedMapProfile.operational_base}
                            </div>
                          ) : null}
                          {selectedMapProfile?.sigla_area ? (
                            <div className="text-[12px] text-muted-foreground truncate">{selectedMapProfile.sigla_area}</div>
                          ) : null}
                          <div className="text-[11px] text-muted-foreground">
                            {tr("sepbook.mapHintSelectThenOpen")}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Button type="button" size="sm" variant="outline" asChild disabled={!selectedMapTelUrl}>
                              <a href={selectedMapTelUrl || "#"} aria-disabled={!selectedMapTelUrl} onClick={(e) => !selectedMapTelUrl && e.preventDefault()}>
                                {tr("userPopover.call")}
                              </a>
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!selectedMapWhatsAppUrl}
                              onClick={() => selectedMapWhatsAppUrl && window.open(selectedMapWhatsAppUrl, "_blank", "noopener,noreferrer")}
                            >
                              {tr("userPopover.whatsapp")}
                            </Button>
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
                        {selectedMapPost.kind === "comment" && selectedMapPost.comment_id ? (
                          <Button type="button" size="sm" onClick={() => openCommentById(selectedMapPost.post_id, selectedMapPost.comment_id!)}>
                            {tr("sepbook.openComment")}
                          </Button>
                        ) : (
                          <Button type="button" size="sm" onClick={() => openPostById(selectedMapPost.post_id)}>
                            {tr("sepbook.openPost")}
                          </Button>
                        )}
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
                      key={`gps-${x.key}`}
                      type="button"
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl border p-2 hover:bg-muted text-left",
                        mapSelectedId === x.key && "border-amber-400/80 bg-amber-100/10",
                      )}
                      onClick={() => handleMapSelection(x.key, { openOnSecond: true })}
                    >
                      <img
                        src={x.imageUrl || undefined}
                        alt={tr("sepbook.photo")}
                        className="h-16 w-16 rounded-lg object-cover border"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMapSelection(x.key, { openOnSecond: true });
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <UserProfilePopover userId={x.user_id} name={x.author_name} avatarUrl={x.author_avatar}>
                          <button
                            type="button"
                            className="text-[13px] font-semibold truncate hover:underline p-0 bg-transparent border-0 text-left"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {formatName(x.author_name)}
                          </button>
                        </UserProfilePopover>
                        {mapProfiles[String(x.user_id || "")]?.operational_base ? (
                          <div className="text-[12px] text-muted-foreground truncate">
                            {tr("userPopover.baseLabel")}: {mapProfiles[String(x.user_id || "")]!.operational_base}
                          </div>
                        ) : null}
                        <div className="text-[12px] text-muted-foreground truncate">
                          {(() => {
                            const coords = clampLatLng(Number(x.location_lat), Number(x.location_lng));
                            const safe = sanitizeLocationLabel(x.location_label);
                            const base = String(mapProfiles[String(x.user_id || "")]?.operational_base || "").trim().toLowerCase();
                            const looksLikeBase = safe && base && safe.toLowerCase() === base;
                            const key = coords ? geoKeyFor(coords.lat, coords.lng) : null;
                            const geo = key ? geoLabelCacheRef.current[key] || null : null;
                            const city = coords ? (looksLikeBase || !safe ? geo : safe) : null;
                            const coordLabel = coords ? formatLatLng(coords.lat, coords.lng) : null;
                            const out = [city, coordLabel].filter(Boolean).join(" • ");
                            return out || tr("sepbook.location");
                          })()}
                          {x.kind === "comment" ? ` • ${tr("sepbook.commentLabel")}` : ""}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {new Date(x.created_at).toLocaleString()}
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

      {/* GPS consent is handled globally on login via SepbookGpsConsentPrompt */}
    </div>
  );
}
