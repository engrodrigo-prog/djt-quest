import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemedBackground } from "@/components/ThemedBackground";
import Navigation from "@/components/Navigation";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Target, Hash, MessageSquare, Zap, ArrowLeft, Share2, MapPinned } from "lucide-react";
import { buildAbsoluteAppUrl, openWhatsAppShare } from "@/lib/whatsappShare";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { apiFetch } from "@/lib/api";
import { UserProfilePopover } from "@/components/UserProfilePopover";
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
  final_points: number | null;
  evidence_urls: string[];
  sepbook_post_id: string | null;
  location_label: string | null;
  location_lat: number | null;
  location_lng: number | null;
};

const isImageUrl = (url: string) => /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(String(url || ""));

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
  const { toast } = useToast();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [topics, setTopics] = useState<ForumTopicRow[]>([]);
  const [posts, setPosts] = useState<SepPostRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  const mapInstanceRef = useRef<L.Map | null>(null);

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

        // Evidence: only approved items (appears after evaluation)
        try {
          const resp = await apiFetch(`/api/campaign-evidence?campaign_id=${encodeURIComponent(String(campRow.id))}&limit=200`);
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(json?.error || "Falha ao carregar evidências");
          setEvidence(Array.isArray(json.items) ? (json.items as any) : []);
        } catch {
          setEvidence([]);
        }
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

  const mapEvidence = useMemo(() => {
    return (evidence || [])
      .map((e) => {
        const imageUrl = (Array.isArray(e.evidence_urls) ? e.evidence_urls : []).find((u) => isImageUrl(u)) || null;
        const hasGps = typeof e.location_lat === "number" && typeof e.location_lng === "number";
        return { e, imageUrl, hasGps };
      })
      .filter((x) => x.hasGps && Boolean(x.imageUrl));
  }, [evidence]);

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
                <Button size="sm" onClick={handleOpenSepbookDraft}>
                  <Zap className="h-4 w-4 mr-1" />
                  Subir no SEPBook
                </Button>
                {campaign?.evidence_challenge_id ? (
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/challenge/${encodeURIComponent(String(campaign.evidence_challenge_id))}`)}>
                    Enviar evidência
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
            {evidence.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ainda não há evidências aprovadas para esta campanha.</p>
            ) : (
              evidence.slice(0, 25).map((ev) => {
                const firstImg = (Array.isArray(ev.evidence_urls) ? ev.evidence_urls : []).find((u) => isImageUrl(u)) || null;
                return (
                  <div key={ev.id} className="flex items-start gap-3 rounded-lg border p-2">
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
                      <div className="flex items-center gap-2 mt-1">
                        {typeof ev.location_lat === "number" && typeof ev.location_lng === "number" ? (
                          <Badge variant="secondary" className="text-[10px]">
                            GPS
                          </Badge>
                        ) : null}
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
                          <div className="text-[12px] text-muted-foreground">{x.e.location_label || "GPS"}</div>
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
                      <div className="text-[12px] text-muted-foreground truncate">{x.e.location_label || "GPS"}</div>
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

      <Navigation />
    </div>
  );
}
