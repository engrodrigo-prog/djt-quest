import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

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

export function GuardiaoVidaDashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [userSearch, setUserSearch] = useState<string>("");
  const [userSuggestions, setUserSuggestions] = useState<UserPick[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserPick[]>([]);
  const [metric, setMetric] = useState<"people_impacted" | "actions">("people_impacted");
  const [from, setFrom] = useState<string>(monthStartIso());
  const [to, setTo] = useState<string>(todayIso());
  const [totals, setTotals] = useState<{ actions: number; people_impacted: number }>({ actions: 0, people_impacted: 0 });
  const [monthly, setMonthly] = useState<DashboardResponse["monthly"]>([]);

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
      } finally {
        setLoading(false);
      }
    },
    [campaignId, from, selectedUsers, to],
  );

  useEffect(() => {
    void fetchDashboard({ campaignId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = userSearch.trim();
    if (!q || q.length < 2) {
      setUserSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const resp = await apiFetch("/api/profile-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "name", query: q, limit: 10 }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao buscar usuários");
        const rows = Array.isArray(json?.users) ? json.users : [];
        const next: UserPick[] = rows
          .map((r: any) => ({
            id: String(r?.id || ""),
            name: r?.name != null ? String(r.name) : null,
            email: r?.email != null ? String(r.email) : null,
            matricula: r?.matricula != null ? String(r.matricula) : null,
          }))
          .filter((u) => u.id);
        if (!cancelled) setUserSuggestions(next);
      } catch {
        if (!cancelled) setUserSuggestions([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userSearch]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => String(c.id) === String(campaignId)) || null,
    [campaignId, campaigns],
  );

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
              <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Digite nome ou e-mail (mín. 2 letras)" />
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
              {userSuggestions.length > 0 ? (
                <div className="rounded-md border bg-background p-1 max-h-36 overflow-auto">
                  {userSuggestions.map((u) => {
                    const already = selectedUsers.some((s) => s.id === u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className="w-full text-left rounded px-2 py-1.5 hover:bg-muted text-sm flex items-center justify-between gap-2"
                        onClick={() => {
                          if (already) return;
                          setSelectedUsers((prev) => [...prev, u].slice(0, 8));
                        }}
                        disabled={already}
                        title={already ? "Já selecionado" : "Adicionar"}
                      >
                        <span className="min-w-0">
                          <span className="font-medium truncate block">{u.name || "Usuário"}</span>
                          <span className="text-[11px] text-muted-foreground truncate block">{u.email || u.matricula || u.id}</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">{already ? "Selecionado" : "Adicionar"}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
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
                  <Bar dataKey="total" fill="var(--color-total)" radius={4} />
                ) : (
                  selectedUsers.map((u, idx) => (
                    <Bar key={u.id} dataKey={u.id} stackId="users" fill={`var(--color-${u.id})`} radius={idx === selectedUsers.length - 1 ? 4 : 0} />
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
