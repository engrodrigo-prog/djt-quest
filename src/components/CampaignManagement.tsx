import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2 } from "lucide-react";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { localeToOpenAiLanguageTag } from "@/lib/i18n/language";

type RangeKey = "30" | "60" | "180" | "365";

interface Campaign {
  id: string;
  title: string;
  description?: string | null;
  narrative_tag?: string | null;
  is_active?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
}

export const CampaignManagement = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<RangeKey>("30");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      setCampaigns(data || []);
    } catch (e) {
      console.error("Erro ao carregar campanhas:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const cutoff = (() => {
    const days = range === "30" ? 30 : range === "60" ? 60 : range === "180" ? 180 : 365;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  })();

  const filtered = campaigns.filter((c) => {
    if (!c.start_date) return true;
    const d = new Date(c.start_date);
    return d >= cutoff;
  });

  const setActive = async (c: Campaign, active: boolean) => {
    if (!c.id) return;
    try {
      const msg = active
        ? "Reabrir esta campanha para novo ciclo?"
        : "Encerrar esta campanha? Ela deixará de aparecer como ativa.";
      if (!window.confirm(msg)) return;
      const { error } = await supabase
        .from("campaigns")
        .update({ is_active: active })
        .eq("id", c.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert(String(e?.message || "Erro ao atualizar campanha"));
    }
  };

  const handleDelete = async (c: Campaign) => {
    if (!c.id) return;
    const msg =
      "Excluir esta campanha permanentemente?\n\nOs desafios/quizzes ligados a ela permanecem, mas a campanha não aparecerá mais nos filtros.";
    if (!window.confirm(msg)) return;
    try {
      const { error } = await supabase.from("campaigns").delete().eq("id", c.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert(String(e?.message || "Erro ao excluir campanha"));
    }
  };

  const handleEdit = (c: Campaign) => {
    setEditingId(c.id);
    setEditTitle(c.title || "");
    setEditDescription(c.description || "");
  };

  const handleSaveEdit = async (c: Campaign) => {
    const title = editTitle.trim();
    const description = editDescription.trim() || null;
    if (!title) {
      alert("Informe um título para a campanha.");
      return;
    }
    try {
      const before = {
        title: c.title,
        description: c.description,
        narrative_tag: c.narrative_tag,
      };
      const after = {
        title,
        description,
        narrative_tag: c.narrative_tag,
      };
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      const { error } = await supabase
        .from("campaigns")
        .update({ title, description })
        .eq("id", c.id);
      if (error) throw error;
      // Log da alteração para validação pelo nível acima
      if (uid) {
        await supabase.from("content_change_requests").insert({
          item_type: "campaign",
          item_id: c.id,
          action: "update",
          requested_by: uid,
          status: "pending",
          payload_before: before,
          payload_after: after,
        });
      }
      setEditingId(null);
      await load();
    } catch (e: any) {
      alert(String(e?.message || "Erro ao salvar alterações"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-blue-50">Gerenciar Campanhas</h2>
          <p className="text-blue-100/80 text-sm">
            Veja campanhas ativas/encerradas, filtre por período e reabra ciclos.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {[
            { key: "30", label: "30 dias" },
            { key: "60", label: "60 dias" },
            { key: "180", label: "Semestre" },
            { key: "365", label: "Ano" },
          ].map((opt) => (
            <Button
              key={opt.key}
              size="sm"
              variant={range === opt.key ? "secondary" : "outline"}
              onClick={() => setRange(opt.key as RangeKey)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campanhas ({filtered.length})</CardTitle>
          <CardDescription className="text-xs">
            Período considerado a partir dos últimos {range === "30" ? "30 dias" : range === "60" ? "60 dias" : range === "180" ? "6 meses" : "12 meses"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-xs text-muted-foreground">Carregando campanhas...</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma campanha no período selecionado.</p>
          )}
          {filtered.map((c) => {
            const isEditing = editingId === c.id;
            return (
              <div
                key={c.id}
                className="flex flex-col gap-1 border rounded-md p-3 bg-black/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {c.narrative_tag && (
                        <Badge className="text-[10px]">{c.narrative_tag}</Badge>
                      )}
                      {isEditing ? (
                        <input
                          className="text-sm font-semibold w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-blue-50"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                      ) : (
                        <span className="font-semibold text-sm truncate text-blue-50">
                          {c.title}
                        </span>
                      )}
                    </div>
                    {isEditing ? (
                      <>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-blue-100/80">
                          <span>Use a varinha para revisar a descrição desta campanha.</span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={async () => {
                              const source = editDescription.trim();
                              if (source.length < 3) return;
                              try {
                                const resp = await fetch("/api/ai?handler=cleanup-text", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ title: "Descrição da campanha", description: source, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
                                });
                                const j = await resp.json().catch(() => ({}));
                                const cleaned = j?.cleaned?.description;
                                if (!resp.ok || !cleaned) throw new Error(j?.error || "Falha na revisão automática");
                                setEditDescription(String(cleaned));
                              } catch (e: any) {
                                alert(String(e?.message || "Não foi possível revisar a descrição agora."));
                              }
                            }}
                            title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                          >
                            <Wand2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <textarea
                          className="mt-1 w-full text-xs bg-black/40 border border-white/10 rounded px-2 py-1 text-muted-foreground"
                          rows={3}
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                        />
                      </>
                    ) : (
                      c.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {c.description}
                        </p>
                      )
                    )}
                    {c.start_date && !isEditing && (
                      <p className="text-[10px] text-blue-200/80 mt-1">
                        {new Date(c.start_date).toLocaleDateString(getActiveLocale())}{" "}
                        {c.end_date
                          ? `– ${new Date(c.end_date).toLocaleDateString(getActiveLocale())}`
                          : ""}
                      </p>
                    )}
                  </div>
                <div className="flex flex-col gap-1 items-end">
                    <Badge
                      variant={c.is_active ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {c.is_active ? "Ativa" : "Encerrada"}
                    </Badge>
                    <div className="flex gap-1 mt-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => handleSaveEdit(c)}
                          >
                            Salvar
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setEditingId(null)}
                          >
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleEdit(c)}
                          >
                            Editar
                          </Button>
                          {c.is_active ? (
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => setActive(c, false)}
                            >
                              Encerrar
                            </Button>
                          ) : (
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => setActive(c, true)}
                            >
                              Reabrir
                            </Button>
                          )}
                          <Button
                            size="xs"
                            variant="destructive"
                            onClick={() => handleDelete(c)}
                          >
                            Excluir
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};
