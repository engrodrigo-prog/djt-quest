import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, MapPinned, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

type CampaignLite = {
  id: string;
  title: string | null;
  narrative_tag: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  evidence_challenge_id: string | null;
};

type DashboardResponse = {
  campaigns: CampaignLite[];
  selected_campaign: CampaignLite | null;
  query: { name: string | null; date_start: string | null; date_end: string | null; user_ids?: string[] | null };
  totals: { actions: number; people_impacted: number };
  publishers?: Array<{ id: string; name: string | null; email?: string | null; matricula?: string | null }> | null;
  map_points?: Array<{
    event_id: string;
    user_id: string | null;
    user_name: string | null;
    user_avatar: string | null;
    user_team: string | null;
    user_base: string | null;
    created_at: string | null;
    status: string | null;
    people_impacted: number | null;
    location_label: string | null;
    location_lat: number;
    location_lng: number;
    urls: string[];
  }> | null;
  users?: Array<{ id: string; name: string | null }> | null;
  totals_by_user?: Record<string, { actions: number; people_impacted: number }> | null;
  monthly: Array<{ month: string; actions: number; people_impacted: number; by_user?: Record<string, { actions: number; people_impacted: number }> }>;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

const formatMonthLabel = (ym: string) => {
  try {
    if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
    const d = new Date(`${ym}-01T00:00:00.000Z`);
    return d.toLocaleDateString(getActiveLocale(), { month: "short", year: "2-digit" });
  } catch {
    return ym;
  }
};

type UserPick = { id: string; name: string | null; email?: string | null; matricula?: string | null };

const darkGreenPalette = (count: number) => {
  const n = Math.max(1, Math.min(12, Math.floor(count || 1)));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const light = 18 + i * Math.floor(18 / Math.max(1, n - 1)); // 18..36
    out.push(`hsl(152, 46%, ${light}%)`);
  }
  return out;
};

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
});

const isImageUrl = (url: string) => /\.(png|jpg|jpeg|webp|gif|avif|heic|heif)(\?|#|$)/i.test(String(url || ""));

function GuardiaoFitBounds({ points }: { points: Array<[number, number]> }) {
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

const renderBarCenterLabel = (props: any) => {
  const x = Number(props?.x || 0);
  const y = Number(props?.y || 0);
  const width = Number(props?.width || 0);
  const height = Number(props?.height || 0);
  const value = Number(props?.value || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 18) return null;
  return (
    <text
      x={x + width / 2}
      y={y + height / 2}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={11}
      fontWeight={600}
      fill="rgba(255,255,255,0.94)"
      stroke="rgba(0,0,0,0.35)"
      strokeWidth={2}
      paintOrder="stroke"
    >
      {value.toLocaleString(getActiveLocale())}
    </text>
  );
};

export function GuardiaoVidaDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState<string>("");
  const [publisherUsers, setPublisherUsers] = useState<UserPick[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserPick[]>([]);
  const [metric, setMetric] = useState<"people_impacted" | "actions">("people_impacted");
  const [from, setFrom] = useState<string>(monthStartIso());
  const [to, setTo] = useState<string>(todayIso());
  const [totals, setTotals] = useState<{ actions: number; people_impacted: number }>({ actions: 0, people_impacted: 0 });
  const [monthly, setMonthly] = useState<DashboardResponse["monthly"]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapPoints, setMapPoints] = useState<NonNullable<DashboardResponse["map_points"]>>([]);

  const chartConfig = useMemo(() => {
    if (selectedUsers.length === 0) {
      return {
        total: { label: metric === "actions" ? "Ações" : "Pessoas atingidas", color: "hsl(152, 46%, 22%)" },
      };
    }
    const colors = darkGreenPalette(selectedUsers.length);
    const cfg: Record<string, any> = {};
    selectedUsers.forEach((u, idx) => {
      cfg[u.id] = { label: u.name || "Usuário", color: colors[idx] || "hsl(152, 46%, 22%)" };
    });
    return cfg;
  }, [metric, selectedUsers]);

  const chartData = useMemo(() => {
    if (selectedUsers.length === 0) {
      return monthly.map((m: any) => ({
        month: m.month,
        total: metric === "actions" ? Number(m.actions || 0) || 0 : Number(m.people_impacted || 0) || 0,
      }));
    }
    return (monthly as any[]).map((m) => {
      const row: any = { month: m.month };
      const by = m.by_user || {};
      selectedUsers.forEach((u) => {
        const v = by[u.id] || { actions: 0, people_impacted: 0 };
        row[u.id] = metric === "actions" ? Number(v.actions || 0) || 0 : Number(v.people_impacted || 0) || 0;
      });
      return row;
    });
  }, [metric, monthly, selectedUsers]);

  const fetchDashboard = useCallback(
    async (opts?: { campaignId?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        const cid = String(opts?.campaignId ?? campaignId ?? "").trim();
        if (cid) qs.set("campaign_id", cid);
        if (selectedUsers.length > 0) qs.set("user_ids", selectedUsers.map((u) => u.id).join(","));
        if (from) qs.set("date_start", from);
        if (to) qs.set("date_end", to);

        const resp = await apiFetch(`/api/guardiao-vida-dashboard?${qs.toString()}`, { cache: "no-store" });
        const json = (await resp.json().catch(() => ({}))) as Partial<DashboardResponse> & { error?: string };
        if (!resp.ok) throw new Error(json?.error || "Falha ao carregar dashboard");

        const nextCampaigns = Array.isArray(json.campaigns) ? (json.campaigns as CampaignLite[]) : [];
        const selected = (json.selected_campaign as CampaignLite | null) || null;

        setCampaigns(nextCampaigns);
        if (selected?.id) setCampaignId(selected.id);

        const pubsRaw = Array.isArray(json.publishers) ? json.publishers : [];
        const pubs: UserPick[] = pubsRaw
          .map((r: any) => ({
            id: String(r?.id || ""),
            name: r?.name != null ? String(r.name) : null,
            email: r?.email != null ? String(r.email) : null,
            matricula: r?.matricula != null ? String(r.matricula) : null,
          }))
          .filter((u) => u.id);
        setPublisherUsers(pubs);

        const t = json.totals || { actions: 0, people_impacted: 0 };
        setTotals({
          actions: Number((t as any).actions || 0) || 0,
          people_impacted: Number((t as any).people_impacted || 0) || 0,
        });

        setMonthly(Array.isArray(json.monthly) ? (json.monthly as any) : []);
      } catch (e: any) {
        setError(e?.message || "Falha ao carregar dashboard");
        setTotals({ actions: 0, people_impacted: 0 });
        setMonthly([]);
        setPublisherUsers([]);
      } finally {
        setLoading(false);
      }
    },
    [campaignId, from, selectedUsers, to],
  );

  const fetchMapPoints = useCallback(async () => {
    setMapLoading(true);
    setMapError(null);
    try {
      const qs = new URLSearchParams();
      const cid = String(campaignId || "").trim();
      if (cid) qs.set("campaign_id", cid);
      if (selectedUsers.length > 0) qs.set("user_ids", selectedUsers.map((u) => u.id).join(","));
      if (from) qs.set("date_start", from);
      if (to) qs.set("date_end", to);
      qs.set("include_map", "1");
      qs.set("map_limit", "500");

      const resp = await apiFetch(`/api/guardiao-vida-dashboard?${qs.toString()}`, { cache: "no-store" });
      const json = (await resp.json().catch(() => ({}))) as Partial<DashboardResponse> & { error?: string };
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar mapa");
      const pts = Array.isArray(json.map_points) ? (json.map_points as any[]) : [];
      const cleaned = pts
        .map((p: any) => ({
          event_id: String(p?.event_id || ""),
          user_id: p?.user_id != null ? String(p.user_id) : null,
          user_name: p?.user_name != null ? String(p.user_name) : null,
          user_avatar: p?.user_avatar != null ? String(p.user_avatar) : null,
          user_team: p?.user_team != null ? String(p.user_team) : null,
          user_base: p?.user_base != null ? String(p.user_base) : null,
          created_at: p?.created_at != null ? String(p.created_at) : null,
          status: p?.status != null ? String(p.status) : null,
          people_impacted: p?.people_impacted != null ? Number(p.people_impacted) : null,
          location_label: p?.location_label != null ? String(p.location_label) : null,
          location_lat: Number(p?.location_lat),
          location_lng: Number(p?.location_lng),
          urls: Array.isArray(p?.urls) ? p.urls.map((u: any) => String(u || "")).filter(Boolean) : [],
        }))
        .filter((p) => p.event_id && Number.isFinite(p.location_lat) && Number.isFinite(p.location_lng));
      setMapPoints(cleaned);
    } catch (e: any) {
      setMapError(e?.message || "Falha ao carregar mapa");
      setMapPoints([]);
    } finally {
      setMapLoading(false);
    }
  }, [campaignId, from, selectedUsers, to]);

  useEffect(() => {
    void fetchDashboard({ campaignId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredPublisherSuggestions = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const list = Array.isArray(publisherUsers) ? publisherUsers : [];
    if (!q) return list.slice(0, 40);
    const out: UserPick[] = [];
    for (const u of list) {
      const hay = `${u.name || ""} ${u.email || ""} ${u.matricula || ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
      out.push(u);
      if (out.length >= 40) break;
    }
    return out;
  }, [publisherUsers, userSearch]);

  const userPickerLabel = useMemo(() => {
    if (selectedUsers.length === 0) return "Todos os usuários";
    if (selectedUsers.length === 1) return selectedUsers[0]?.name || selectedUsers[0]?.email || "1 usuário selecionado";
    return `${selectedUsers.length} usuários selecionados`;
  }, [selectedUsers]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => String(c.id) === String(campaignId)) || null,
    [campaignId, campaigns],
  );

  const mapEvidence = useMemo(() => {
    const points = Array.isArray(mapPoints) ? mapPoints : [];
    return points.map((p) => {
      const imageUrl = (p.urls || []).find((u) => isImageUrl(u)) || null;
      return { p, imageUrl };
    });
  }, [mapPoints]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Guardião da Vida — Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Campanha</Label>
              <Select value={campaignId} onValueChange={(v) => setCampaignId(String(v || ""))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title || "Campanha"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCampaign?.narrative_tag ? (
                <p className="text-[11px] text-muted-foreground">#{String(selectedCampaign.narrative_tag).replace(/^#/, "")}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Usuários (para contabilizar)</Label>
              <Popover
                open={userPickerOpen}
                onOpenChange={(open) => {
                  setUserPickerOpen(open);
                  if (!open) setUserSearch("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={userPickerOpen}
                    className="w-full justify-between"
                    disabled={loading || publisherUsers.length === 0}
                    title={publisherUsers.length === 0 ? "Carregando lista de usuários…" : "Selecionar usuários"}
                  >
                    <span className="truncate">{publisherUsers.length === 0 ? "Carregando lista…" : userPickerLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0 z-50 bg-popover border shadow-lg"
                  align="start"
                  sideOffset={4}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Pesquisar (nome, e-mail ou matrícula)"
                      value={userSearch}
                      onValueChange={setUserSearch}
                    />
                    <CommandList>
                      <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                      <CommandGroup
                        heading={
                          filteredPublisherSuggestions.length > 0
                            ? `${filteredPublisherSuggestions.length} opção(ões)`
                            : undefined
                        }
                      >
                        {filteredPublisherSuggestions.map((u) => {
                          const already = selectedUsers.some((s) => s.id === u.id);
                          const label = u.name || u.email || u.matricula || "Usuário";
                          const hint = u.email || u.matricula || u.id;
                          return (
                            <CommandItem
                              key={u.id}
                              value={u.id}
                              onMouseDown={(e) => e.preventDefault()}
                              onSelect={() => {
                                setSelectedUsers((prev) => {
                                  const exists = prev.some((x) => x.id === u.id);
                                  if (exists) return prev.filter((x) => x.id !== u.id);
                                  return [...prev, u].slice(0, 12);
                                });
                              }}
                              className={already ? "bg-accent" : undefined}
                            >
                              <Check className={`mr-2 h-4 w-4 ${already ? "opacity-100" : "opacity-0"}`} />
                              <span className="min-w-0">
                                <span className="font-medium truncate block">{label}</span>
                                <span className="text-[11px] text-muted-foreground truncate block">{hint}</span>
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                    <div className="flex items-center justify-between gap-2 border-t p-2">
                      <p className="text-[11px] text-muted-foreground truncate">
                        Lista: {publisherUsers.length} usuários que já publicaram
                      </p>
                      {selectedUsers.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedUsers([])}
                          className="h-8 px-2"
                          title="Limpar seleção"
                        >
                          Limpar
                        </Button>
                      ) : null}
                    </div>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedUsers.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {selectedUsers.map((u) => (
                    <Badge key={u.id} variant="secondary" className="gap-1">
                      <span className="truncate max-w-[140px]">{u.name || u.email || "Usuário"}</span>
                      <button
                        type="button"
                        className="ml-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
                        onClick={() => setSelectedUsers((prev) => prev.filter((x) => x.id !== u.id))}
                        aria-label="Remover usuário"
                        title="Remover"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Sem filtro: contabiliza todos os usuários.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>De</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Até</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={metric} onValueChange={(v) => setMetric(v === "actions" ? "actions" : "people_impacted")}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Métrica" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="people_impacted">Pessoas atingidas</SelectItem>
                  <SelectItem value="actions">Ações</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={() => fetchDashboard()} disabled={loading}>
                {loading ? "Carregando…" : "Atualizar"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMapOpen(true);
                  void fetchMapPoints();
                }}
                disabled={loading || !campaignId}
                title={!campaignId ? "Selecione uma campanha" : "Ver ações no mapa"}
              >
                <MapPinned className="h-4 w-4 mr-2" />
                Mapa
              </Button>
              {selectedUsers.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedUsers([])}
                  disabled={loading}
                  title="Remover filtro de usuários"
                >
                  Limpar usuários
                </Button>
              ) : null}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={mapOpen}
        onOpenChange={(open) => {
          if (!open) {
            setMapOpen(false);
            setMapError(null);
          } else {
            setMapOpen(true);
          }
        }}
      >
        <DialogContent className="max-w-5xl p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>Mapa — Guardião da Vida</DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              Mostra as ações com GPS no período/usuários filtrados.
            </DialogDescription>
          </DialogHeader>

          {mapLoading ? (
            <div className="px-4 pb-6 text-sm text-muted-foreground">Carregando mapa…</div>
          ) : mapError ? (
            <div className="px-4 pb-6 text-sm text-destructive">{mapError}</div>
          ) : mapEvidence.length === 0 ? (
            <div className="px-4 pb-6 text-sm text-muted-foreground">Nenhuma ação com GPS encontrada para o filtro.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t">
              <div className="h-[48vh] md:h-[70vh] border-b md:border-b-0 md:border-r">
                <MapContainer
                  center={[Number(mapEvidence[0].p.location_lat), Number(mapEvidence[0].p.location_lng)]}
                  zoom={12}
                  scrollWheelZoom={false}
                  zoomAnimation={false}
                  fadeAnimation={false}
                  markerZoomAnimation={false}
                  className="h-full w-full"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <GuardiaoFitBounds
                    points={mapEvidence.map((x) => [Number(x.p.location_lat), Number(x.p.location_lng)] as [number, number])}
                  />
                  {mapEvidence.map((x) => (
                    <Marker key={x.p.event_id} position={[Number(x.p.location_lat), Number(x.p.location_lng)]}>
                      <Popup>
                        <div className="space-y-2">
                          <div className="text-[12px] font-semibold">{x.p.user_name || "Usuário"}</div>
                          <div className="text-[12px] text-muted-foreground">{x.p.location_label || "GPS"}</div>
                          {x.p.people_impacted != null ? (
                            <div className="text-[12px] text-muted-foreground">Pessoas atingidas: {Number(x.p.people_impacted || 0).toLocaleString(getActiveLocale())}</div>
                          ) : null}
                          {x.imageUrl ? (
                            <img src={x.imageUrl} alt="Ação" className="w-[220px] max-w-full rounded-md border" />
                          ) : null}
                          {campaignId ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                navigate(`/campaign/${encodeURIComponent(campaignId)}?event=${encodeURIComponent(String(x.p.event_id))}`)
                              }
                            >
                              Abrir evidência
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
                  <button
                    key={`ev-${x.p.event_id}`}
                    type="button"
                    className="w-full flex items-center gap-3 rounded-xl border p-2 hover:bg-accent/10 text-left"
                    onClick={() => {
                      if (!campaignId) return;
                      navigate(`/campaign/${encodeURIComponent(campaignId)}?event=${encodeURIComponent(String(x.p.event_id))}`);
                    }}
                  >
                    {x.imageUrl ? (
                      <img src={x.imageUrl} alt="Ação" className="h-16 w-16 rounded-lg object-cover border" />
                    ) : (
                      <div className="h-16 w-16 rounded-lg border bg-muted/30 flex items-center justify-center text-[11px] text-muted-foreground">
                        GPS
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">{x.p.user_name || "Usuário"}</div>
                      <div className="text-[12px] text-muted-foreground truncate">{x.p.location_label || "GPS"}</div>
                      {x.p.created_at ? (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {new Date(x.p.created_at).toLocaleString(getActiveLocale(), { dateStyle: "short", timeStyle: "short" })}
                        </div>
                      ) : null}
                    </div>
                    {x.p.people_impacted != null ? (
                      <Badge variant="secondary" className="text-[11px] shrink-0">
                        {Number(x.p.people_impacted || 0).toLocaleString(getActiveLocale())}
                      </Badge>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Total de ações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{Number(totals.actions || 0).toLocaleString(getActiveLocale())}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total de pessoas atingidas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{Number(totals.people_impacted || 0).toLocaleString(getActiveLocale())}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Barras mensais (empilhado por usuário)</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados no período filtrado.</p>
          ) : (
            <ChartContainer config={chartConfig} className="w-full">
              <BarChart data={chartData} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  minTickGap={18}
                  tickFormatter={(v) => formatMonthLabel(String(v || ""))}
                />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={58} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                {selectedUsers.length === 0 ? (
                  <Bar dataKey="total" fill="var(--color-total)" radius={4}>
                    <LabelList content={renderBarCenterLabel} />
                  </Bar>
                ) : (
                  selectedUsers.map((u, idx) => (
                    <Bar
                      key={u.id}
                      dataKey={u.id}
                      stackId="users"
                      fill={`var(--color-${u.id})`}
                      radius={idx === selectedUsers.length - 1 ? 4 : 0}
                    >
                      <LabelList content={renderBarCenterLabel} />
                    </Bar>
                  ))
                )}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
