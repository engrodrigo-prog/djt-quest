import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock } from "lucide-react";
import { getActiveLocale } from "@/lib/i18n/activeLocale";

interface ChangeRequest {
  id: string;
  user_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string;
  status: string;
  created_at: string;
  profiles: {
    name: string;
    email: string;
  };
}

export function PendingApprovals() {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const readInvokeError = async (err: any) => {
    const fallback = String(err?.message || 'Erro ao processar solicitação');
    const ctx = err?.context;
    if (ctx && typeof ctx === 'object') {
      try {
        const json = await ctx.json().catch(() => ({}));
        const msg = json?.error;
        if (msg) return String(msg);
      } catch {
        // ignore
      }
      try {
        const text = await ctx.text().catch(() => '');
        const trimmed = String(text || '').trim();
        if (trimmed) return trimmed.slice(0, 240);
      } catch {
        // ignore
      }
    }
    return fallback;
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('profile_change_requests')
        .select(`
          *,
          profiles!user_id (name, email)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error fetching requests:', error);
      toast.error('Erro ao carregar solicitações');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (requestId: string, action: 'approved' | 'rejected') => {
    try {
      const { error } = await supabase.functions.invoke('review-profile-change', {
        body: {
          request_id: requestId,
          action,
          review_notes: reviewNotes[requestId] || null,
        },
      });

      if (error) throw error;

      toast.success(`Solicitação ${action === 'approved' ? 'aprovada' : 'rejeitada'}!`);
      fetchRequests();
      setReviewNotes({ ...reviewNotes, [requestId]: '' });
    } catch (error) {
      console.error('Error reviewing request:', error);
      toast.error(await readInvokeError(error));
    }
  };

  const fieldLabels: Record<string, string> = {
    operational_base: 'Base Operacional',
    sigla_area: 'Sigla da Área',
  };

  if (loading) {
    return <div>Carregando solicitações...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Aprovações Pendentes
        </CardTitle>
        <CardDescription>
          {requests.length === 0 
            ? 'Não há solicitações pendentes'
            : `${requests.length} solicitação(ões) aguardando revisão`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {requests.map((request) => (
          <Card key={request.id} className="border-2">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{request.profiles.name}</CardTitle>
                  <CardDescription>{request.profiles.email}</CardDescription>
                </div>
                <Badge variant="outline">Pendente</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Campo: {fieldLabels[request.field_name] || request.field_name}</p>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground line-through">
                    {request.old_value || '(vazio)'}
                  </span>
                  <span>→</span>
                  <span className="font-semibold">{request.new_value}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Solicitado em {new Date(request.created_at).toLocaleString(getActiveLocale())}
                </p>
              </div>

              <Textarea
                placeholder="Notas de revisão (opcional)"
                value={reviewNotes[request.id] || ''}
                onChange={(e) => setReviewNotes({ ...reviewNotes, [request.id]: e.target.value })}
                className="min-h-[60px]"
              />

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="flex-1"
                  onClick={() => handleReview(request.id, 'approved')}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => handleReview(request.id, 'rejected')}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Rejeitar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}
