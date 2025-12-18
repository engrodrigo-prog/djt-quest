import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CheckCircle, XCircle, Clock, Mail, Phone, MapPin, Hash } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

interface PendingRegistration {
  id: string;
  name: string;
  email: string;
  date_of_birth?: string | null;
  telefone: string | null;
  matricula: string | null;
  operational_base: string;
  sigla_area: string;
  status: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

export function PendingRegistrationsManager() {
  const { toast } = useToast();
  const { orgScope, userRole, isLeader, profile } = useAuth() as any;
  const [registrations, setRegistrations] = useState<PendingRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<{ [key: string]: string }>({});
  const [assignCurator, setAssignCurator] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    // Default: mostrar tudo para staff/líder (evita pendências sumirem por escopo)
    setShowAll(true);
  }, [userRole]);

  const fetchRegistrations = useCallback(async () => {
    try {
      // Prefer Vercel API (bypass RLS; necessário para líderes), fallback para select direto
      try {
        const resp = await apiFetch("/api/admin?handler=studio-list-pending-registrations", {
          method: "GET",
          cache: "no-store",
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || "Falha ao carregar solicitações");
        const list = Array.isArray(json?.registrations) ? json.registrations : [];
        // Se o backend responder 200 porém vazio (comum quando cai em anon/RLS),
        // faz uma segunda tentativa via select direto (respeitando RLS do usuário logado).
        if (list.length === 0) {
          const { data, error } = await supabase
            .from("pending_registrations")
            .select("*")
            .order("created_at", { ascending: false });
          if (!error && (data?.length || 0) > 0) {
            setRegistrations(data || []);
            return;
          }
        }
        setRegistrations(list);
        return;
      } catch (apiErr) {
        const { data, error } = await supabase
          .from("pending_registrations")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        setRegistrations(data || []);
      }
    } catch (error: any) {
      console.error("Error fetching registrations:", error);
      toast({
        title: "Erro ao carregar solicitações",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRegistrations();
  }, [fetchRegistrations]);

  const approveRegistration = async (registrationId: string, notes: string) => {
    // Prefer Vercel API route (robust upsert), fallback to Edge Function
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    try {
      const resp = await fetch('/api/admin?handler=approve-registration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          registrationId,
          notes: notes || '',
          assign_content_curator: Boolean(assignCurator[registrationId]),
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || 'Falha na aprovação');
      }
      return;
    } catch (apiErr) {
      const { error } = await supabase.functions.invoke("approve-registration", {
        body: {
          registrationId,
          notes: notes || "",
          assign_content_curator: Boolean(assignCurator[registrationId]),
        },
      });
      if (error) throw error;
    }
  };

  const handleApprove = async (registration: PendingRegistration) => {
    setProcessingId(registration.id);
    try {
      await approveRegistration(registration.id, reviewNotes[registration.id] || "");
      toast({
        title: "Cadastro aprovado!",
        description: `Usuário ${registration.name} criado com sucesso.`,
      });
      fetchRegistrations();
    } catch (error: any) {
      console.error("Error approving registration:", error);
      toast({
        title: "Erro ao aprovar cadastro",
        description: error.message || "Tente novamente mais tarde",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (registration: PendingRegistration) => {
    if (!reviewNotes[registration.id]) {
      toast({
        title: "Motivo obrigatório",
        description: "Informe o motivo da rejeição",
        variant: "destructive",
      });
      return;
    }

    setProcessingId(registration.id);

    try {
      // Prefer Vercel API (bypass RLS), fallback para update direto
      try {
        const resp = await apiFetch("/api/admin?handler=reject-registration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registrationId: registration.id,
            notes: reviewNotes[registration.id],
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j?.error || "Falha ao rejeitar");
      } catch (apiErr) {
        const { error } = await supabase
          .from("pending_registrations")
          .update({
            status: "rejected",
            review_notes: reviewNotes[registration.id],
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", registration.id);

        if (error) throw error;
      }

      toast({
        title: "Cadastro rejeitado",
        description: "O solicitante será notificado.",
      });

      fetchRegistrations();
    } catch (error: any) {
      console.error("Error rejecting registration:", error);
      toast({
        title: "Erro ao rejeitar cadastro",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  const inScope = (r: PendingRegistration) => {
    const sigla = (r.sigla_area || '').toUpperCase();
    const div = (orgScope?.divisionId || '').toUpperCase();
    const coord = (orgScope?.coordId || '').toUpperCase();
    const team = (orgScope?.teamId || profile?.team_id || profile?.sigla_area || profile?.operational_base || '').toUpperCase();
    if (userRole === 'admin' || userRole === 'gerente_djt') return true;
    if (userRole === 'gerente_divisao_djtx') return !!div && sigla.startsWith(div);
    if (userRole === 'coordenador_djtx') return (!!div && sigla.startsWith(div)) || (!!coord && sigla.startsWith(coord)) || (!!team && sigla === team);
    if (userRole === 'lider_equipe' || isLeader) return sigla === "CONVIDADOS" || (!!team && sigla === team);
    return false;
  };

  const canManageAny = userRole === "admin" || userRole === "gerente_djt";
  const canAssignCuratorRole =
    Boolean(isLeader) ||
    canManageAny ||
    String(userRole || "").includes("gerente") ||
    String(userRole || "").includes("coordenador");

  const isGuestRegistration = (r: PendingRegistration) => {
    const s = String(r.sigla_area || "").trim().toUpperCase();
    return s === "CONVIDADOS" || s === "EXTERNO";
  };

  const matchesSearch = (r: PendingRegistration, q: string) => {
    const hay = [
      r.name,
      r.email,
      r.telefone || "",
      r.matricula || "",
      r.operational_base,
      r.sigla_area,
      r.status,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };

  const q = search.trim().toLowerCase();
  const allPending = registrations.filter((r) => r.status === "pending");
  const pendingBase = (showAll || canManageAny) ? allPending : allPending.filter(inScope);
  const pendingRegistrations = q ? pendingBase.filter((r) => matchesSearch(r, q)) : pendingBase;

  const processedBase = registrations.filter((r) => r.status !== "pending");
  const processedRegistrations = q ? processedBase.filter((r) => matchesSearch(r, q)) : processedBase;

  const approveAllPending = async () => {
    const list = (showAll || canManageAny) ? allPending : allPending.filter(inScope);
    const actionable = canManageAny ? list : list.filter(inScope);
    if (!actionable.length) {
      toast({ title: "Nenhum cadastro pendente para aprovar." });
      return;
    }

    const ok = window.confirm(
      `Aprovar ${actionable.length} cadastro(s) pendente(s)?\\n\\nIsso criará usuários (senha inicial 123456) e marcará as solicitações como aprovadas.`
    );
    if (!ok) return;

    setBulkApproving(true);
    setBulkProgress({ done: 0, total: actionable.length });

    const errors: string[] = [];
    for (let i = 0; i < actionable.length; i++) {
      const r = actionable[i];
      setProcessingId(r.id);
      try {
        await approveRegistration(r.id, reviewNotes[r.id] || "");
      } catch (e: any) {
        errors.push(`${r.name}: ${e?.message || "falha"}`);
      } finally {
        setBulkProgress({ done: i + 1, total: actionable.length });
      }
    }

    setProcessingId(null);
    setBulkApproving(false);
    setBulkProgress(null);
    await fetchRegistrations();

    if (errors.length) {
      toast({
        title: "Aprovação em massa concluída com erros",
        description: errors.slice(0, 3).join(" • ") + (errors.length > 3 ? ` • +${errors.length - 3}` : ""),
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Todos os cadastros pendentes foram aprovados!" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Solicitações de Cadastro
        </h2>
        <p className="text-muted-foreground">
          Aprovar ou rejeitar solicitações de novos usuários
        </p>
      </div>

      {/* Pending Registrations */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-500" />
            Pendentes ({pendingRegistrations.length})
          </h3>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            <div className="flex items-center gap-2">
              <Switch
                id="show-all-reg"
                checked={showAll || canManageAny}
                onCheckedChange={setShowAll}
                disabled={canManageAny}
              />
              <Label htmlFor="show-all-reg" className="text-sm text-muted-foreground">
                Mostrar todos
              </Label>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar (nome, email, sigla...)"
              className="md:w-[260px]"
            />
            <Button
              type="button"
              onClick={approveAllPending}
              disabled={bulkApproving || processingId !== null || allPending.length === 0}
              variant="default"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {bulkProgress ? `Aprovando ${bulkProgress.done}/${bulkProgress.total}` : "Aprovar todos"}
            </Button>
          </div>
        </div>

        {pendingRegistrations.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Nenhuma solicitação pendente
              </p>
            </CardContent>
          </Card>
        ) : (
          pendingRegistrations.map((registration) => (
            <Card key={registration.id} className="border-yellow-500/20">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-xl">{registration.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <Mail className="h-3 w-3" />
                      {registration.email}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {!canManageAny && showAll && !inScope(registration) && (
                      <Badge variant="outline" className="text-slate-500 border-slate-400">
                        Fora do escopo
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                      Pendente
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {registration.date_of_birth && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Nasc.: {new Date(`${registration.date_of_birth}T00:00:00`).toLocaleDateString("pt-BR")}</span>
                    </div>
                  )}
                  {registration.telefone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{registration.telefone}</span>
                    </div>
                  )}
                  {registration.matricula && (
                    <div className="flex items-center gap-2">
                      <Hash className="h-4 w-4 text-muted-foreground" />
                      <span>{registration.matricula}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{registration.operational_base}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{registration.sigla_area}</Badge>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`notes-${registration.id}`}>
                    Observações (opcional para aprovação, obrigatório para rejeição)
                  </Label>
                  <Textarea
                    id={`notes-${registration.id}`}
                    placeholder="Adicione observações sobre esta solicitação..."
                    value={reviewNotes[registration.id] || ""}
                    onChange={(e) =>
                      setReviewNotes({
                        ...reviewNotes,
                        [registration.id]: e.target.value,
                      })
                    }
                    rows={2}
                  />
                </div>

                {canAssignCuratorRole && isGuestRegistration(registration) && (
                  <div className="flex items-center justify-between border border-white/10 rounded-md p-3 bg-black/20">
                    <div>
                      <Label>Curador de Conteúdo</Label>
                      <p className="text-xs text-muted-foreground">
                        Opcional para convidados: acesso apenas ao HUB de curadoria no Studio.
                      </p>
                    </div>
                    <Switch
                      checked={Boolean(assignCurator[registration.id])}
                      onCheckedChange={(v) =>
                        setAssignCurator((prev) => ({ ...prev, [registration.id]: Boolean(v) }))
                      }
                    />
                  </div>
                )}

                <div className="flex gap-3">
                  <Button
                    onClick={() => handleApprove(registration)}
                    disabled={
                      bulkApproving ||
                      processingId === registration.id ||
                      (!canManageAny && showAll && !inScope(registration))
                    }
                    className="flex-1"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {processingId === registration.id ? "Processando..." : "Aprovar"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleReject(registration)}
                    disabled={
                      bulkApproving ||
                      processingId === registration.id ||
                      (!canManageAny && showAll && !inScope(registration))
                    }
                    className="flex-1"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Rejeitar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Processed Registrations */}
      {processedRegistrations.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">
            Histórico ({processedRegistrations.length})
          </h3>
          {processedRegistrations.map((registration) => (
            <Card key={registration.id} className="opacity-75">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{registration.name}</CardTitle>
                    <CardDescription>{registration.email}</CardDescription>
                  </div>
                  <Badge
                    variant={registration.status === "approved" ? "default" : "destructive"}
                  >
                    {registration.status === "approved" ? "Aprovado" : "Rejeitado"}
                  </Badge>
                </div>
              </CardHeader>
              {registration.review_notes && (
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    <strong>Observações:</strong> {registration.review_notes}
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
