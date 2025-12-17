import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Mail, User, CheckCircle, XCircle } from 'lucide-react';
import { fetchTeamNames } from '@/lib/teamLookup';
import { apiFetch } from '@/lib/api';

interface PasswordResetRequest {
  id: string;
  identifier: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  processed_at: string | null;
  reviewer_notes: string | null;
  processed_by: string | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    matricula: string | null;
    team_id?: string | null;
    team?: { name: string | null } | null;
  } | null;
}

export function PasswordResetManager({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('password_reset_requests')
        .select('id, identifier, reason, status, requested_at, processed_at, reviewer_notes, processed_by, user:profiles!password_reset_requests_user_id_fkey(id, name, email, matricula, team_id)')
        .order('requested_at', { ascending: false });

      if (error) throw error;
      const teamIds = (data || [])
        .map((req) => req.user?.team_id)
        .filter((id): id is string => Boolean(id));
      const teamMap = await fetchTeamNames(teamIds);

      const hydrated = (data as PasswordResetRequest[]).map((req) => ({
        ...req,
        user: req.user
          ? {
              ...req.user,
              team: req.user.team_id ? { name: teamMap[req.user.team_id] || null } : null,
            }
          : null,
      }));

      setRequests(hydrated || []);
    } catch (error) {
      console.error('Erro ao carregar resets:', error);
      toast({ title: 'Erro ao carregar solicitações de senha', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleAction = async (requestId: string, action: 'approve' | 'reject') => {
    try {
      setProcessingId(requestId);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Sessão expirada');

      const response = await apiFetch('/api/admin?handler=review-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, action, notes: notes[requestId] || null }),
      });

      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Falha ao processar solicitação');

      toast({
        title: action === 'approve' ? 'Reset aprovado' : 'Reset rejeitado',
        description: action === 'approve'
          ? 'Senha redefinida para 123456 e marcada para troca obrigatória.'
          : 'Solicitação rejeitada com sucesso.',
      });
      setNotes((prev) => ({ ...prev, [requestId]: '' }));
      fetchRequests();
    } catch (error: any) {
      toast({
        title: 'Erro ao processar solicitação',
        description: error?.message,
        variant: 'destructive',
      });
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const processed = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h2 className="text-2xl font-bold">Solicitações de Reset de Senha</h2>
          <p className="text-muted-foreground">
            Aprove ou rejeite pedidos de redefinição de senha dos colaboradores. Ao aprovar, a senha volta para 123456 e o usuário será obrigado a alterar no próximo acesso.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pendentes ({pending.length})</CardTitle>
          <CardDescription>Solicitações aguardando revisão</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pending.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma solicitação pendente</p>
          ) : (
            pending.map((request) => (
              <div key={request.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <div>
                    <p className="font-semibold flex items-center gap-2"><User className="h-4 w-4" />{request.user?.name || 'Sem nome'}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Mail className="h-3 w-3" />
                      {request.user?.email || 'Sem email'}
                    </p>
                    {request.user?.matricula && (
                      <p className="text-xs text-muted-foreground">Matrícula: {request.user.matricula}</p>
                    )}
                    {request.user?.team?.name && (
                      <p className="text-xs text-muted-foreground">Equipe: {request.user.team.name}</p>
                    )}
                  </div>
                  <Badge variant="outline">Solicitado em {new Date(request.requested_at).toLocaleString('pt-BR')}</Badge>
                </div>

                {request.reason && (
                  <div className="text-sm bg-muted/40 border rounded-md p-3">
                    <p className="font-semibold mb-1">Motivo informado:</p>
                    <p>{request.reason}</p>
                  </div>
                )}

                <Textarea
                  placeholder="Notas (opcional)"
                  value={notes[request.id] || ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [request.id]: e.target.value }))}
                />

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="game"
                    className="flex-1 md:flex-none"
                    onClick={() => handleAction(request.id, 'approve')}
                    disabled={processingId === request.id}
                  >
                    {processingId === request.id ? 'Aprovando...' : 'Aprovar reset'}
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 md:flex-none"
                    onClick={() => handleAction(request.id, 'reject')}
                    disabled={processingId === request.id}
                  >
                    {processingId === request.id ? 'Processando...' : 'Rejeitar'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Solicitações já tratadas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {processed.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma solicitação processada ainda.</p>
          ) : (
            processed.map((request) => (
              <div key={request.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <div>
                    <p className="font-semibold">{request.user?.name || 'Usuário'}</p>
                    <p className="text-xs text-muted-foreground">{request.identifier}</p>
                  </div>
                  <Badge variant={request.status === 'approved' ? 'default' : 'secondary'}>
                    {request.status === 'approved' ? 'Aprovado' : 'Rejeitado'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Processado em {request.processed_at ? new Date(request.processed_at).toLocaleString('pt-BR') : '-'}
                </p>
                {request.reviewer_notes && (
                  <p className="text-sm">Notas: {request.reviewer_notes}</p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
