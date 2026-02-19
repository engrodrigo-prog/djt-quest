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
  query: { name: string | null; date_start: string | null; date_end: string | null };
  totals: { actions: number; people_impacted: number };
  monthly: Array<{ month: string; actions: number; people_impacted: number }>;
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

export function GuardiaoVidaDashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [from, setFrom] = useState<string>(monthStartIso());
  const [to, setTo] = useState<string>(todayIso());
  const [totals, setTotals] = useState<{ actions: number; people_impacted: number }>({ actions: 0, people_impacted: 0 });
  const [monthly, setMonthly] = useState<Array<{ month: string; actions: number; people_impacted: number }>>([]);

  const chartConfig = useMemo(
    () => ({
      actions: { label: "Ações", color: "hsl(var(--chart-1))" },
      people_impacted: { label: "Pessoas atingidas", color: "hsl(var(--chart-2))" },
    }),
    [],
  );

  const fetchDashboard = useCallback(
    async (opts?: { campaignId?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        const cid = String(opts?.campaignId ?? campaignId ?? "").trim();
        if (cid) qs.set("campaign_id", cid);
        if (name.trim()) qs.set("name", name.trim());
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
    [campaignId, from, name, to],
  );

  useEffect(() => {
    void fetchDashboard({ campaignId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <Label>Nome contém</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Maria" />
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
            <Button type="button" variant="outline" onClick={() => fetchDashboard()} disabled={loading}>
              {loading ? "Carregando…" : "Atualizar"}
            </Button>
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
          <CardTitle>Barras mensais</CardTitle>
        </CardHeader>
        <CardContent>
          {monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados no período filtrado.</p>
          ) : (
            <ChartContainer config={chartConfig} className="w-full">
              <BarChart data={monthly} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  minTickGap={18}
                  tickFormatter={(v) => formatMonthLabel(String(v || ""))}
                />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} allowDecimals={false} width={42} />
                <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} width={58} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar yAxisId="left" dataKey="actions" fill="var(--color-actions)" radius={4} />
                <Bar yAxisId="right" dataKey="people_impacted" fill="var(--color-people_impacted)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

