import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle, XCircle, Clock, Mail, Phone, MapPin, Hash } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface PendingRegistration {
  id: string;
  name: string;
  email: string;
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
  const { orgScope, userRole } = useAuth() as any;
  const [registrations, setRegistrations] = useState<PendingRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<{ [key: string]: string }>({});

  const fetchRegistrations = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("pending_registrations")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRegistrations(data || []);
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

  const handleApprove = async (registration: PendingRegistration) => {
    setProcessingId(registration.id);

    try {
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
            registrationId: registration.id,
            notes: reviewNotes[registration.id] || '',
          }),
        });
        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          throw new Error(j?.error || 'Falha na aprovação');
        }
      } catch (apiErr) {
        // Fallback to Edge Function if API route is unavailable
        const { error } = await supabase.functions.invoke("approve-registration", {
          body: {
            registrationId: registration.id,
            notes: reviewNotes[registration.id] || "",
          },
        });
        if (error) throw error;
      }

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
      const { error } = await supabase
        .from("pending_registrations")
        .update({
          status: "rejected",
          review_notes: reviewNotes[registration.id],
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", registration.id);

      if (error) throw error;

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
    const team = (orgScope?.teamId || '').toUpperCase();
    if (userRole === 'admin' || userRole === 'gerente_djt') return true;
    if (userRole === 'gerente_divisao_djtx') return !!div && sigla.startsWith(div);
    if (userRole === 'coordenador_djtx') return (!!div && sigla.startsWith(div)) || (!!coord && sigla.startsWith(coord)) || (!!team && sigla === team);
    return false;
  };

  const pendingRegistrations = registrations.filter((r) => r.status === "pending").filter(inScope);
  const processedRegistrations = registrations.filter((r) => r.status !== "pending");

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
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5 text-yellow-500" />
          Pendentes ({pendingRegistrations.length})
        </h3>

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
                  <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                    Pendente
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
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

                <div className="flex gap-3">
                  <Button
                    onClick={() => handleApprove(registration)}
                    disabled={processingId === registration.id}
                    className="flex-1"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {processingId === registration.id ? "Processando..." : "Aprovar"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleReject(registration)}
                    disabled={processingId === registration.id}
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
