import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemedBackground } from "@/components/ThemedBackground";
import Navigation from "@/components/Navigation";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Target, Hash, MessageSquare, Zap, ArrowLeft, Share2, MapPinned, Plus, Pencil } from "lucide-react";
import { buildAbsoluteAppUrl, openWhatsAppShare } from "@/lib/whatsappShare";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { apiFetch } from "@/lib/api";
import { UserProfilePopover } from "@/components/UserProfilePopover";
import { CampaignEvidenceWizard } from "@/components/CampaignEvidenceWizard";
import { AttachmentViewer } from "@/components/AttachmentViewer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
});

interface Campaign {
  id: string;
  title: string;
  description: string | null;
  narrative_tag: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active?: boolean | null;
  evidence_challenge_id?: string | null;
  created_by?: string | null;
  archived_at?: string | null;
}

interface ChallengeRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  xp_reward: number;
  reward_mode?: string | null;
  reward_tier_steps?: number | null;
}

interface ForumTopicRow {
  id: string;
  title: string;
  description: string | null;
}

interface SepPostRow {
  id: string;
  content_md: string;
  like_count: number;
  comment_count: number;
  created_at: string;
}

type EvidenceItem = {
  id: string;
  user_id: string;
  author_name: string;
  author_team: string | null;
  author_avatar: string | null;
  author_base?: string | null;
  created_at: string;
  status?: string | null;
  final_points: number | null;
  avg_rating?: number | null;
  evaluations?: Array<{
    id: string | null;
    event_id: string;
    reviewer_id: string | null;
    reviewer_name: string;
    reviewer_avatar: string | null;
    reviewer_team: string | null;
    reviewer_base: string | null;
    reviewer_level: string | null;
    evaluation_number: number | null;
    rating: number | string | null;
    final_rating: number | string | null;
    feedback_positivo: string | null;
    feedback_construtivo: string | null;
    created_at: string | null;
  }>;
  evidence_urls: string[];
  sepbook_post_id: string | null;
  location_label: string | null;
  location_lat: number | null;
  location_lng: number | null;
  sap_service_note?: string | null;
  people_impacted?: number | null;
  tags?: string[];
};

const isImageUrl = (url: string) => /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(String(url || ""));

const sanitizeLocationLabel = (raw: any) => {
  const label = String(raw || "").trim();
  if (!label) return null;
  if (/(lat|lng)\s*-?\d{1,2}\.\d+|gps.*-?\d{1,2}\.\d+,\s*-?\d{1,3}\.\d+/i.test(label)) {
    if (/gps da foto/i.test(label)) return "GPS da foto";
    if (/local atual/i.test(label)) return "Local atual";
    return "Localização";
  }
  if (/-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(label)) return "Localização";
  return label;
};

const toDateInputValue = (raw: string | null | undefined) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes("T")) return s.split("T")[0] || "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
};

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
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
      map.whenReady(() => window.setTimeout(run, 80));
    } catch {
      window.setTimeout(run, 80);
    }
    return () => {
      cancelled = true;
    };
  }, [map, points]);
  return null;
}

export default function CampaignDetail() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user, roles, userRole } = useAuth() as any;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [topics, setTopics] = useState<ForumTopicRow[]>([]);
  const [posts, setPosts] = useState<SepPostRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidencePermissions, setEvidencePermissions] = useState<{
    can_view_all: boolean;
    is_guest: boolean;
    user_team_id: string | null;
  } | null>(null);
  const [evidenceTotals, setEvidenceTotals] = useState<{ items: number; total_xp: number } | null>(null);

  const [evScope, setEvScope] = useState<"mine" | "team" | "all">("mine");
  const [evUserId, setEvUserId] = useState<string>("");
  const [evDateStart, setEvDateStart] = useState<string>("");
  const [evDateEnd, setEvDateEnd] = useState<string>("");
  const [evSearch, setEvSearch] = useState<string>("");
  const [evShowLimit, setEvShowLimit] = useState<number>(25);

  const focusedEventId = useMemo(() => {
    const q = String(searchParams.get("event") || "").trim();
    if (q) return q;
    try {
      const hash = String(window.location.hash || "").trim();
      if (hash.toLowerCase().startsWith("#event-")) return decodeURIComponent(hash.slice("#event-".length));
    } catch {
      // ignore
    }
    return "";
  }, [searchParams]);

  const [evidenceDetailOpen, setEvidenceDetailOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);

  const [mapOpen, setMapOpen] = useState(false);
  const [evidenceWizardOpen, setEvidenceWizardOpen] = useState(false);
  const [campaignEditOpen, setCampaignEditOpen] = useState(false);
  const [campaignEditSaving, setCampaignEditSaving] = useState(false);
  const [campaignEdit, setCampaignEdit] = useState({
    title: "",
    description: "",
    narrative_tag: "",
    start_date: "",
    end_date: "",
    is_active: true,
  });
  const mapInstanceRef = useRef<L.Map | null>(null);
  const evScopeInitRef = useRef(false);
  const evScopeInitAppliedRef = useRef(false);
  const didFocusEventRef = useRef<string | null>(null);

  useEffect(() => {
    evScopeInitRef.current = false;
    evScopeInitAppliedRef.current = false;
    didFocusEventRef.current = null;
  }, [campaignId]);

  const computeHashTag = (c: Campaign) => {
    if (c?.narrative_tag && String(c.narrative_tag).trim().length > 0) {
      const raw = String(c.narrative_tag).trim();
      return raw.startsWith("#") ? raw : `#${raw}`;
    }
    const slug = String(c?.title || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `#camp_${slug || "djt"}`;
  };

  const reloadEvidence = useCallback(async (campId: string, override?: { scope?: string; user_id?: string; date_start?: string; date_end?: string }) => {
    try {
      setEvidenceLoading(true);
      const params = new URLSearchParams();
      params.set("campaign_id", String(campId));
      params.set("limit", "250");
      const scope = String(override?.scope ?? evScope ?? "").trim();
      const user_id = String(override?.user_id ?? evUserId ?? "").trim();
      const date_start = String(override?.date_start ?? evDateStart ?? "").trim();
      const date_end = String(override?.date_end ?? evDateEnd ?? "").trim();
      if (scope) params.set("scope", scope);
      if (user_id) params.set("user_id", user_id);
      if (date_start) params.set("date_start", date_start);
      if (date_end) params.set("date_end", date_end);
      const resp = await apiFetch(`/api/campaign-evidence?${params.toString()}`);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar evidências");
      setEvidence(Array.isArray(json.items) ? (json.items as any) : []);
      setEvidencePermissions(json?.permissions || null);
      setEvidenceTotals(json?.totals || null);
      setEvShowLimit(25);
    } catch {
      setEvidence([]);
      setEvidencePermissions(null);
      setEvidenceTotals(null);
    } finally {
      setEvidenceLoading(false);
    }
  }, [evDateEnd, evDateStart, evScope, evUserId]);

  const reloadPosts = useCallback(async (camp: Campaign) => {
    const hashTag = computeHashTag(camp);
    try {
      const { data } = await supabase
        .from("sepbook_posts")
        .select("id,content_md,like_count,comment_count,created_at")
        .eq("campaign_id", camp.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setPosts(((data as any) || []) as any);
    } catch {
      const { data } = await supabase
        .from("sepbook_posts")
        .select("id,content_md,like_count,comment_count,created_at")
        .ilike("content_md", `%${hashTag}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      setPosts(((data as any) || []) as any);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!campaignId) return;
      setLoading(true);
      try {
        const { data: camp, error: campErr } = await supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
        if (campErr) throw campErr;
        if (!camp) {
          toast({
            title: "Campanha não encontrada",
            description: "Verifique se o link ainda é válido.",
            variant: "destructive",
          });
          return;
        }

        const campRow = camp as any;
        const hashTag = computeHashTag(campRow);

        const [chRows, topicRows, postRows] = await Promise.all([
          supabase
            .from("challenges")
            .select("id,title,description,type,xp_reward,reward_mode,reward_tier_steps")
            .eq("campaign_id", campaignId)
            .order("created_at", { ascending: false }),
          (async () => {
            try {
              const { data } = await supabase
                .from("forum_topics")
                .select("id,title,description")
                .eq("campaign_id", campaignId)
                .order("created_at", { ascending: false })
                .limit(30);
              return { data };
            } catch {
              const { data } = await supabase
                .from("forum_topics")
                .select("id,title,description")
                .or(`title.ilike.%${hashTag.replace("#", "")}%,description.ilike.%${hashTag.replace("#", "")}%`)
                .order("created_at", { ascending: false })
                .limit(20);
              return { data };
            }
          })(),
          (async () => {
            try {
              const { data } = await supabase
                .from("sepbook_posts")
                .select("id,content_md,like_count,comment_count,created_at")
                .eq("campaign_id", campaignId)
                .order("created_at", { ascending: false })
                .limit(20);
              return { data };
            } catch {
              const { data } = await supabase
                .from("sepbook_posts")
                .select("id,content_md,like_count,comment_count,created_at")
                .ilike("content_md", `%${hashTag}%`)
                .order("created_at", { ascending: false })
                .limit(20);
              return { data };
            }
          })(),
        ]);

        setCampaign(campRow);
        setChallenges(((chRows as any)?.data || []) as any);
        setTopics(((topicRows as any)?.data || []) as any);
        setPosts(((postRows as any)?.data || []) as any);

        // Evidence history (approved) for this campaign
        await reloadEvidence(campRow.id);
      } catch (e: any) {
        console.error("Erro ao carregar campanha", e);
        toast({
          title: "Erro ao carregar campanha",
          description: e?.message || "Tente novamente mais tarde.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const handleOpenSepbookDraft = () => {
    if (!campaign) return;
    try {
      const content = `&"${campaign.title}"`;
      localStorage.setItem("sepbook_draft", JSON.stringify({ content }));
    } catch {
      /* ignore */
    }
    navigate("/sepbook");
  };

  const currentUserId = String(user?.id || "");
  const roleList: string[] = Array.isArray(roles) ? roles : [];
  const isStaff = useMemo(() => {
    const set = new Set(roleList.map((r) => String(r || "").trim()));
    if (set.has("admin")) return true;
    if (set.has("gerente_djt") || set.has("gerente")) return true;
    if (set.has("gerente_divisao_djtx") || set.has("lider_divisao")) return true;
    if (set.has("coordenador_djtx") || set.has("coordenador")) return true;
    return String(userRole || "").toLowerCase() === "admin";
  }, [roleList, userRole]);

  const canEditCampaign = useMemo(() => {
    if (!campaign || !currentUserId) return false;
    if (isStaff) return true;
    if (campaign.created_by && String(campaign.created_by) === currentUserId) return true;
    return false;
  }, [campaign, currentUserId, isStaff]);

  const canViewAllEvidence = useMemo(() => {
    if (isStaff) return true;
    const set = new Set(roleList.map((r) => String(r || "").trim()));
    if (set.has("lider_equipe")) return true;
    if (set.has("coordenador") || set.has("coordenador_djtx")) return true;
    if (set.has("lider_divisao") || set.has("gerente_divisao_djtx")) return true;
    return false;
  }, [isStaff, roleList]);

  useEffect(() => {
    if (evScopeInitRef.current) return;
    if (!currentUserId) return;
    const next = canViewAllEvidence ? "all" : "mine";
    setEvScope(next);
    evScopeInitRef.current = true;
  }, [campaign?.id, canViewAllEvidence, currentUserId, reloadEvidence]);

  useEffect(() => {
    if (!evScopeInitRef.current) return;
    if (evScopeInitAppliedRef.current) return;
    if (!campaign?.id) return;
    evScopeInitAppliedRef.current = true;
    reloadEvidence(campaign.id);
  }, [campaign?.id, evScope, reloadEvidence]);

  const openCampaignEditor = () => {
    if (!campaign) return;
    setCampaignEdit({
      title: String(campaign.title || ""),
      description: String(campaign.description || ""),
      narrative_tag: String(campaign.narrative_tag || ""),
      start_date: toDateInputValue(campaign.start_date),
      end_date: toDateInputValue(campaign.end_date),
      is_active: campaign.is_active !== false,
    });
    setCampaignEditOpen(true);
  };

  const saveCampaignChanges = async (patch?: Partial<typeof campaignEdit>) => {
    if (!campaign) return;
    setCampaignEditSaving(true);
    try {
      const next = { ...campaignEdit, ...(patch || {}) };
      const title = String(next.title || "").trim();
      if (!title) throw new Error("Título obrigatório.");
      if (next.start_date && next.end_date && next.end_date < next.start_date) {
        throw new Error("A data final deve ser maior ou igual à data inicial.");
      }

      const update: any = {
        title,
        description: String(next.description || "").trim() || null,
        narrative_tag: String(next.narrative_tag || "").trim() || null,
        is_active: Boolean(next.is_active),
      };
      if (next.start_date) update.start_date = next.start_date;
      if (next.end_date) update.end_date = next.end_date;

      const { error } = await supabase.from("campaigns").update(update).eq("id", campaign.id);
      if (error) throw error;

      // Refresh campaign row
      const { data: fresh } = await supabase.from("campaigns").select("*").eq("id", campaign.id).maybeSingle();
      if (fresh) setCampaign(fresh as any);

      toast({ title: "Campanha atualizada", description: "Alterações salvas com sucesso." });
      setCampaignEditOpen(false);
    } catch (e: any) {
      toast({ title: "Erro ao salvar campanha", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setCampaignEditSaving(false);
    }
  };

  const toggleArchiveCampaign = async (archived: boolean) => {
    if (!campaign) return;
    const msg = archived
      ? "Arquivar campanha? Ela deixará de aparecer para usuários finais, mas manterá posts, evidências e pontos já contabilizados."
      : "Restaurar campanha (desarquivar)?";
    if (!window.confirm(msg)) return;
    setCampaignEditSaving(true);
    try {
      const patch: any = { archived_at: archived ? new Date().toISOString() : null };
      if (archived) patch.is_active = false;
      const { error } = await supabase.from("campaigns").update(patch).eq("id", campaign.id);
      if (error) throw error;
      const { data: fresh } = await supabase.from("campaigns").select("*").eq("id", campaign.id).maybeSingle();
      if (fresh) setCampaign(fresh as any);
      toast({ title: archived ? "Campanha arquivada" : "Campanha restaurada" });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Não foi possível atualizar a campanha.", variant: "destructive" });
    } finally {
      setCampaignEditSaving(false);
    }
  };

  const openEvidenceDetail = useCallback((ev: EvidenceItem) => {
    setSelectedEvidence(ev);
    setEvidenceDetailOpen(true);
  }, []);

  const mapEvidence = useMemo(() => {
    const list = (evidence || [])
      .filter((e) => {
        const q = String(evSearch || "").trim().toLowerCase();
        if (!q) return true;
        const hay = [
          e.author_name,
          e.author_team,
          e.author_base,
          e.location_label,
          Array.isArray((e as any)?.tags) ? (e as any).tags.join(" ") : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });

    return list
      .map((e) => {
        const imageUrl = (Array.isArray(e.evidence_urls) ? e.evidence_urls : []).find((u) => isImageUrl(u)) || null;
        const hasGps = typeof e.location_lat === "number" && typeof e.location_lng === "number";
        return { e, imageUrl, hasGps };
      })
      .filter((x) => x.hasGps && Boolean(x.imageUrl));
  }, [evidence, evSearch]);

  const filteredEvidence = useMemo(() => {
    const q = String(evSearch || "").trim().toLowerCase();
    if (!q) return evidence || [];
    return (evidence || []).filter((e) => {
      const hay = [
        e.author_name,
        e.author_team,
        e.author_base,
        e.location_label,
        Array.isArray((e as any)?.tags) ? (e as any).tags.join(" ") : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [evidence, evSearch]);

  useEffect(() => {
    const eid = String(focusedEventId || "").trim();
    if (!eid) return;
    if (!Array.isArray(evidence) || evidence.length === 0) return;
    if (didFocusEventRef.current === eid) return;
    const found = (evidence || []).find((e) => String((e as any)?.id || "") === eid) as EvidenceItem | undefined;
    if (!found) return;
    didFocusEventRef.current = eid;
    setEvShowLimit(250);
    openEvidenceDetail(found);
    window.setTimeout(() => {
      try {
        const el = document.getElementById(`event-${eid}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // ignore
      }
    }, 120);
  }, [evidence, focusedEventId, openEvidenceDetail]);

  const userOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    (evidence || []).forEach((e) => {
      const id = String(e.user_id || "");
      if (!id) return;
      const name = String(e.author_name || "Colaborador");
      if (!map.has(id)) map.set(id, { id, name });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [evidence]);

  const filteredTotals = useMemo(() => {
    const total_xp = (filteredEvidence || [])
      .map((it) => Number(it?.final_points))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => a + b, 0);
    return { items: (filteredEvidence || []).length, total_xp };
  }, [filteredEvidence]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (!mapEvidence.length) return [-23.55052, -46.633308];
    const sum = mapEvidence.reduce(
      (acc, item) => {
        acc.lat += Number(item.e.location_lat || 0);
        acc.lng += Number(item.e.location_lng || 0);
        return acc;
      },
      { lat: 0, lng: 0 },
    );
    return [sum.lat / mapEvidence.length, sum.lng / mapEvidence.length];
  }, [mapEvidence]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Campanha não encontrada</CardTitle>
            <CardDescription>
              Não foi possível localizar essa campanha. Verifique se o link está correto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/dashboard")}>Voltar ao início</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background pb-40">
      <ThemedBackground theme="habilidades" />
      <div className="container relative mx-auto px-3 py-4 space-y-6">
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Target className="h-5 w-5 text-secondary" />
            Campanha
          </h1>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <Badge className="w-fit mb-1 text-[10px] bg-cyan-700/60 text-blue-50 border-cyan-500/50">
                  {(campaign.narrative_tag && campaign.narrative_tag.trim()) || "Campanha DJT Quest"}
                </Badge>
                <CardTitle className="text-lg leading-tight">{campaign.title}</CardTitle>
                {campaign.description && (
                  <CardDescription className="text-sm">
                    {campaign.description}
                  </CardDescription>
                )}
                <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  <span>{computeHashTag(campaign)}</span>
                </p>
                {campaign.start_date && campaign.end_date && (
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(campaign.start_date).toLocaleDateString(getActiveLocale(), {
                      day: "2-digit",
                      month: "short",
                    })}{" "}
                    -{" "}
                    {new Date(campaign.end_date).toLocaleDateString(getActiveLocale(), {
                      day: "2-digit",
                      month: "short",
                    })}
                  </p>
                )}
              </div>
            <div className="flex flex-col items-end gap-2">
              {canEditCampaign ? (
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={openCampaignEditor} title="Editar campanha">
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : null}
              <Button size="sm" onClick={handleOpenSepbookDraft}>
                <Zap className="h-4 w-4 mr-1" />
                Subir no SEPBook
              </Button>
              {campaign?.evidence_challenge_id ? (
                <Button size="sm" variant="secondary" onClick={() => setEvidenceWizardOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Registrar evidência
                </Button>
              ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => {
                    const url = buildAbsoluteAppUrl(`/campaign/${encodeURIComponent(campaign.id)}`);
                    openWhatsAppShare({
                      message: `Conheça a campanha "${campaign.title}" no DJT Quest:`,
                      url,
                    });
                  }}
                >
                  Compartilhar no WhatsApp
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-sm">Evidências aprovadas</CardTitle>
                <CardDescription className="text-xs">
                  Histórico de evidências (aparece após avaliação). O mapa mostra apenas imagens com GPS.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setMapOpen(true)} disabled={mapEvidence.length === 0}>
                <MapPinned className="h-4 w-4 mr-1" />
                Mapa
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-col gap-2 rounded-lg border p-2 bg-background/40">
              <div className="flex flex-col md:flex-row md:items-end gap-2 md:gap-3">
                {evidencePermissions?.can_view_all ? (
                  <div className="w-full md:w-48">
                    <Label className="text-[11px] text-muted-foreground">Escopo</Label>
                    <div className="mt-1">
                      <Select value={evScope} onValueChange={(v) => setEvScope(v as any)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Escopo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="team">Minha equipe</SelectItem>
                          <SelectItem value="mine">Apenas eu</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

                {evidencePermissions?.can_view_all ? (
                  <div className="w-full md:w-72">
                    <Label className="text-[11px] text-muted-foreground">Colaborador</Label>
                    <div className="mt-1">
                      <Select value={evUserId || "all"} onValueChange={(v) => setEvUserId(v === "all" ? "" : v)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          {userOptions.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

                <div className="w-full md:w-44">
                  <Label className="text-[11px] text-muted-foreground">Data inicial</Label>
                  <Input className="h-9 mt-1" type="date" value={evDateStart} onChange={(e) => setEvDateStart(e.target.value)} />
                </div>
                <div className="w-full md:w-44">
                  <Label className="text-[11px] text-muted-foreground">Data final</Label>
                  <Input className="h-9 mt-1" type="date" value={evDateEnd} onChange={(e) => setEvDateEnd(e.target.value)} />
                </div>
                <div className="w-full md:flex-1">
                  <Label className="text-[11px] text-muted-foreground">Busca</Label>
                  <Input className="h-9 mt-1" value={evSearch} onChange={(e) => setEvSearch(e.target.value)} placeholder="Nome, equipe, base, local..." />
                </div>
                <Button
                  size="sm"
                  className="h-9"
                  variant="secondary"
                  disabled={!campaign || evidenceLoading}
                  onClick={() => {
                    if (!campaign) return;
                    reloadEvidence(campaign.id);
                  }}
                >
                  {evidenceLoading ? "Carregando..." : "Aplicar"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  Mostrando {filteredTotals.items} evidência(s) • XP somado: {Math.round(filteredTotals.total_xp || 0)}
                  {evidenceTotals?.items != null ? ` • Total (sem busca): ${evidenceTotals.items}` : ""}
                </span>
                {evDateStart || evDateEnd || evUserId || (evidencePermissions?.can_view_all && evScope !== "all") ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      setEvUserId("");
                      setEvDateStart("");
                      setEvDateEnd("");
                      setEvSearch("");
                      setEvShowLimit(25);
                      if (!campaign) return;
                      const defaultScope = evidencePermissions?.can_view_all ? "all" : "mine";
                      setEvScope(defaultScope);
                      reloadEvidence(campaign.id, { scope: defaultScope, user_id: "", date_start: "", date_end: "" });
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : null}
              </div>
            </div>

            {filteredEvidence.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ainda não há evidências aprovadas para esta campanha (nesse filtro).</p>
            ) : (
              filteredEvidence.slice(0, evShowLimit).map((ev) => {
                const firstImg = (Array.isArray(ev.evidence_urls) ? ev.evidence_urls : []).find((u) => isImageUrl(u)) || null;
                const evaluations = Array.isArray(ev.evaluations) ? ev.evaluations : [];
                return (
                  <div key={ev.id} id={`event-${ev.id}`} className="flex items-start gap-3 rounded-lg border p-2">
                    {firstImg ? (
                      <img src={firstImg} alt="Evidência" className="h-14 w-14 rounded-md object-cover border" />
                    ) : (
                      <div className="h-14 w-14 rounded-md border bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <UserProfilePopover userId={ev.user_id} name={ev.author_name} avatarUrl={ev.author_avatar}>
                          <button type="button" className="text-[13px] font-semibold truncate hover:underline p-0 bg-transparent border-0 text-left">
                            {ev.author_name}
                          </button>
                        </UserProfilePopover>
                        <div className="text-[11px] text-muted-foreground">{new Date(ev.created_at).toLocaleString(getActiveLocale())}</div>
                      </div>
                      <div className="text-[12px] text-muted-foreground truncate">
                        {(ev.author_team || "DJT") + (ev.author_base ? ` • ${ev.author_base}` : "")}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {typeof ev.final_points === "number" ? (
                          <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">+{Math.round(ev.final_points)} XP</Badge>
                        ) : null}
                        {typeof ev.avg_rating === "number" ? (
                          <Badge variant="outline" className="text-[10px]">
                            Média: {Number(ev.avg_rating).toFixed(1)}
                          </Badge>
                        ) : null}
                        {evaluations.slice(0, 2).map((a) => (
                          <Badge key={a.id || `${ev.id}-${a.reviewer_id}-${a.evaluation_number || "x"}`} variant="secondary" className="text-[10px]">
                            {a.evaluation_number ? `${a.evaluation_number}ª` : "Aval."}{" "}
                            {a.reviewer_name ? `• ${a.reviewer_name}` : ""}{" "}
                            {a.rating != null ? `• Nota ${a.rating}` : ""}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {typeof ev.location_lat === "number" && typeof ev.location_lng === "number" ? (
                          <Badge variant="secondary" className="text-[10px]">
                            GPS
                          </Badge>
                        ) : null}
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => openEvidenceDetail(ev)}
                        >
                          Ver detalhes
                        </Button>
                        {ev.sepbook_post_id ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => navigate(`/sepbook#post-${encodeURIComponent(String(ev.sepbook_post_id))}`)}
                          >
                            Abrir no SEPBook
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {filteredEvidence.length > evShowLimit ? (
              <Button size="sm" variant="outline" onClick={() => setEvShowLimit((n) => n + 25)}>
                Carregar mais
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Desafios & Quizzes</CardTitle>
              <CardDescription className="text-xs">
                Conteúdos formais ligados a esta campanha.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {challenges.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum desafio vinculado diretamente a esta campanha ainda.
                </p>
              )}
              {challenges.map((ch) => (
                <div
                  key={ch.id}
                  className="p-2 rounded-md border hover:bg-accent/10 cursor-pointer"
                  onClick={() => navigate(`/challenge/${ch.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{ch.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {ch.description}
                      </p>
                      <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
                        <span>{ch.type}</span>
                        <span>
                          {ch.reward_mode === 'tier_steps'
                            ? `+${ch.reward_tier_steps || 1} patamar(es)`
                            : `+${ch.xp_reward} XP`}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        const url = buildAbsoluteAppUrl(`/challenge/${encodeURIComponent(ch.id)}`)
                        openWhatsAppShare({
                          message: (ch.type || '').toLowerCase().includes('quiz')
                            ? `Participe deste quiz no DJT Quest:\n${ch.title}`
                            : `Participe deste desafio no DJT Quest:\n${ch.title}`,
                          url,
                        })
                      }}
                      title="Compartilhar no WhatsApp"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Fóruns Relacionados</CardTitle>
              <CardDescription className="text-xs">
                Tópicos onde o tema aparece, para aprofundar discussões.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topics.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Ainda não há fóruns relacionados a esta campanha.
                </p>
              )}
              {topics.map((t) => (
                <div
                  key={t.id}
                  className="p-2 rounded-md border hover:bg-accent/10 cursor-pointer"
                  onClick={() => navigate(`/forum/${t.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {t.description}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(t.id)}`)
                        openWhatsAppShare({
                          message: `Veja este fórum no DJT Quest:\n${t.title}`,
                          url,
                        })
                      }}
                      title="Compartilhar no WhatsApp"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Movimento no SEPBook</CardTitle>
              <CardDescription className="text-xs">
                Publicações espontâneas vinculadas a esta campanha.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {posts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Ainda não há posts no SEPBook vinculados a esta campanha.
                </p>
              )}
              {posts.map((p) => (
                <div key={p.id} className="p-2 rounded-md border">
                  <p className="text-[11px] text-muted-foreground mb-1">
                    {new Date(p.created_at).toLocaleString(getActiveLocale())}
                  </p>
                  <p className="text-sm line-clamp-3 whitespace-pre-wrap">
                    {p.content_md}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                    <span>❤ {p.like_count || 0}</span>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {p.comment_count || 0}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => navigate(`/sepbook#post-${encodeURIComponent(p.id)}`)}
                      title="Abrir no SEPBook"
                    >
                      Abrir
                    </Button>
                    <button
                      type="button"
                      className="ml-auto inline-flex items-center justify-center h-7 w-7 rounded-full border border-border/50 hover:bg-accent"
                      onClick={() => {
                        const url = buildAbsoluteAppUrl(`/sepbook#post-${encodeURIComponent(p.id)}`)
                        const preview = (p.content_md || '').trim().replace(/\s+/g, ' ').slice(0, 140)
                        openWhatsAppShare({
                          message: preview
                            ? `Veja esta publicação no SEPBook (DJT Quest):\n"${preview}${preview.length >= 140 ? '…' : ''}"`
                            : "Veja esta publicação no SEPBook (DJT Quest):",
                          url,
                        })
                      }}
                      title="Compartilhar no WhatsApp"
                      aria-label="Compartilhar publicação do SEPBook no WhatsApp"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={evidenceDetailOpen}
        onOpenChange={(open) => {
          setEvidenceDetailOpen(open);
          if (!open) setSelectedEvidence(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Detalhe da evidência</DialogTitle>
            <DialogDescription>
              {selectedEvidence
                ? `${selectedEvidence.author_name} • ${new Date(selectedEvidence.created_at).toLocaleString(getActiveLocale())}`
                : "Anexos, avaliações e contexto da evidência."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-3 overflow-y-auto pr-1">
            {!selectedEvidence ? (
              <p className="text-sm text-muted-foreground">Selecione uma evidência para ver detalhes.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {typeof selectedEvidence.final_points === "number" ? (
                    <Badge className="text-[11px] bg-primary/10 text-primary border-primary/20">
                      +{Math.round(selectedEvidence.final_points)} XP
                    </Badge>
                  ) : null}
                  {selectedEvidence.status ? (
                    <Badge variant="outline" className="text-[11px] capitalize">
                      {selectedEvidence.status}
                    </Badge>
                  ) : null}
                  {sanitizeLocationLabel(selectedEvidence.location_label) ? (
                    <Badge variant="secondary" className="text-[11px]">
                      {sanitizeLocationLabel(selectedEvidence.location_label)}
                    </Badge>
                  ) : null}
                  {selectedEvidence.sap_service_note ? (
                    <Badge variant="secondary" className="text-[11px]">
                      SAP: {String(selectedEvidence.sap_service_note).slice(0, 18)}
                      {String(selectedEvidence.sap_service_note).length > 18 ? "…" : ""}
                    </Badge>
                  ) : null}
                  {typeof selectedEvidence.people_impacted === "number" && selectedEvidence.people_impacted > 0 ? (
                    <Badge variant="secondary" className="text-[11px]">
                      Pessoas: {Number(selectedEvidence.people_impacted).toLocaleString(getActiveLocale())}
                    </Badge>
                  ) : null}
                </div>

                {Array.isArray(selectedEvidence.evidence_urls) && selectedEvidence.evidence_urls.length > 0 ? (
                  <AttachmentViewer
                    urls={selectedEvidence.evidence_urls}
                    mediaLayout="carousel"
                    enableLightbox
                    showMetadata={false}
                    className="mt-1"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Sem anexos nesta evidência.</p>
                )}

                {selectedEvidence.sap_service_note ? (
                  <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
                    <p className="text-sm font-semibold">Nota SAP</p>
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{selectedEvidence.sap_service_note}</p>
                  </div>
                ) : null}

                {Array.isArray(selectedEvidence.tags) && selectedEvidence.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedEvidence.tags.slice(0, 16).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(selectedEvidence.evaluations) && selectedEvidence.evaluations.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Avaliações</p>
                    {selectedEvidence.evaluations.map((a) => (
                      <div
                        key={a.id || `${a.event_id}-${a.reviewer_id || "x"}-${a.evaluation_number || "x"}`}
                        className="rounded-md border border-white/10 bg-white/[0.02] p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">
                            {a.evaluation_number ? `${a.evaluation_number}ª avaliação` : "Avaliação"}
                            {a.reviewer_name ? ` • ${a.reviewer_name}` : ""}
                          </p>
                          {a.rating != null ? (
                            <Badge variant="secondary" className="text-[11px]">
                              Nota {a.rating}
                            </Badge>
                          ) : null}
                        </div>
                        {a.feedback_positivo ? (
                          <div className="mt-2">
                            <p className="text-xs font-semibold">Pontos positivos</p>
                            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{a.feedback_positivo}</p>
                          </div>
                        ) : null}
                        {a.feedback_construtivo ? (
                          <div className="mt-2">
                            <p className="text-xs font-semibold">Pontos de melhoria</p>
                            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{a.feedback_construtivo}</p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {selectedEvidence.sepbook_post_id ? (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/sepbook#post-${encodeURIComponent(String(selectedEvidence.sepbook_post_id))}`)}
                    >
                      Abrir no SEPBook
                    </Button>
                  </div>
                ) : null}
              </>
            )}
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
            mapInstanceRef.current = null;
          }
          setMapOpen(open);
        }}
      >
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>Mapa de evidências</DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              Apenas imagens com localização GPS estão sendo mostradas.
            </DialogDescription>
          </DialogHeader>

          {mapEvidence.length === 0 ? (
            <div className="px-4 pb-6 text-sm text-muted-foreground">Nenhuma evidência com GPS disponível.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t">
              <div className="h-[48vh] md:h-[70vh] border-b md:border-b-0 md:border-r">
                <MapContainer
                  center={mapCenter}
                  zoom={12}
                  scrollWheelZoom={false}
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
                  <FitBounds
                    points={mapEvidence.map((x) => [Number(x.e.location_lat), Number(x.e.location_lng)] as [number, number])}
                  />
                  {mapEvidence.map((x) => (
                    <Marker key={x.e.id} position={[Number(x.e.location_lat), Number(x.e.location_lng)]}>
                      <Popup>
                        <div className="space-y-2">
                          <UserProfilePopover userId={x.e.user_id} name={x.e.author_name} avatarUrl={x.e.author_avatar}>
                            <button type="button" className="text-[12px] font-semibold hover:underline p-0 bg-transparent border-0 text-left">
                              {x.e.author_name}
                            </button>
                          </UserProfilePopover>
                          <div className="text-[12px] text-muted-foreground">{sanitizeLocationLabel(x.e.location_label) || "GPS"}</div>
                          {x.imageUrl ? (
                            <img src={x.imageUrl} alt="Evidência" className="w-[220px] max-w-full rounded-md border" />
                          ) : null}
                          {x.e.sepbook_post_id ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => navigate(`/sepbook#post-${encodeURIComponent(String(x.e.sepbook_post_id))}`)}
                            >
                              Abrir no SEPBook
                            </Button>
                          ) : null}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
              <div className="max-h-[48vh] md:max-h-[70vh] overflow-auto p-4 space-y-3">
                {mapEvidence.map((x) => (
                  <div
                    key={`ev-${x.e.id}`}
                    role="button"
                    tabIndex={0}
                    className="w-full flex items-center gap-3 rounded-xl border p-2 hover:bg-accent/10 text-left"
                    onClick={() => {
                      if (x.e.sepbook_post_id) navigate(`/sepbook#post-${encodeURIComponent(String(x.e.sepbook_post_id))}`);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (x.e.sepbook_post_id) {
                          navigate(`/sepbook#post-${encodeURIComponent(String(x.e.sepbook_post_id))}`);
                        }
                      }
                    }}
                  >
                    <img src={x.imageUrl || undefined} alt="Evidência" className="h-16 w-16 rounded-lg object-cover border" />
                    <div className="min-w-0 flex-1">
                      <UserProfilePopover userId={x.e.user_id} name={x.e.author_name} avatarUrl={x.e.author_avatar}>
                        <span
                          className="text-[13px] font-semibold truncate hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {x.e.author_name}
                        </span>
                      </UserProfilePopover>
                      <div className="text-[12px] text-muted-foreground truncate">{sanitizeLocationLabel(x.e.location_label) || "GPS"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {new Date(x.e.created_at).toLocaleString(getActiveLocale())}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CampaignEvidenceWizard
        open={evidenceWizardOpen}
        onOpenChange={setEvidenceWizardOpen}
        campaign={campaign}
        onSubmitted={() => {
          if (!campaign) return;
          reloadEvidence(campaign.id);
          reloadPosts(campaign);
        }}
      />

      <Dialog open={campaignEditOpen} onOpenChange={setCampaignEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar campanha</DialogTitle>
            <DialogDescription>
              Alterar prazo, texto e vigência sem afetar posts, evidências e pontos já contabilizados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={campaignEdit.title} onChange={(e) => setCampaignEdit((p) => ({ ...p, title: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                rows={4}
                value={campaignEdit.description}
                onChange={(e) => setCampaignEdit((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Tag</Label>
                <Input value={campaignEdit.narrative_tag} onChange={(e) => setCampaignEdit((p) => ({ ...p, narrative_tag: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Início</Label>
                <Input
                  type="date"
                  value={campaignEdit.start_date}
                  onChange={(e) => setCampaignEdit((p) => ({ ...p, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <Input
                  type="date"
                  value={campaignEdit.end_date}
                  onChange={(e) => setCampaignEdit((p) => ({ ...p, end_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border bg-white/5 p-3">
              <div>
                <p className="text-sm font-semibold">Vigência</p>
                <p className="text-[11px] text-muted-foreground">
                  Ative/desative a campanha (encerrar não apaga histórico).
                </p>
              </div>
              <Switch
                checked={campaignEdit.is_active}
                onCheckedChange={(v) => setCampaignEdit((p) => ({ ...p, is_active: Boolean(v) }))}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    saveCampaignChanges({ is_active: false, end_date: today });
                  }}
                  disabled={campaignEditSaving}
                >
                  Encerrar agora
                </Button>
                <Button
                  type="button"
                  variant={campaign?.archived_at ? "secondary" : "destructive"}
                  onClick={() => toggleArchiveCampaign(!campaign?.archived_at)}
                  disabled={campaignEditSaving}
                >
                  {campaign?.archived_at ? "Restaurar" : "Arquivar"}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setCampaignEditOpen(false)} disabled={campaignEditSaving}>
                  Cancelar
                </Button>
                <Button type="button" onClick={() => saveCampaignChanges()} disabled={campaignEditSaving}>
                  {campaignEditSaving ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Navigation />
    </div>
  );
}
