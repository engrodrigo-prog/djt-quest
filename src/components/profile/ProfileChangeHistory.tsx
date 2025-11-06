import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ChangeRequest {
  id: string;
  field_name: string;
  old_value: string | null;
  new_value: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

const fieldLabels: Record<string, string> = {
  name: 'Nome',
  email: 'Email',
  operational_base: 'Base Operacional',
  sigla_area: 'Sigla da Área',
  date_of_birth: 'Data de Nascimento',
};

export function ProfileChangeHistory() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('profile_change_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (!error && data) {
        setRequests(data as ChangeRequest[]);
      }
      setLoading(false);
    };
    load();
  }, [user]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Solicitações</CardTitle>
        <CardDescription>Últimas alterações enviadas para aprovação.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p>Carregando...</p>}
        {!loading && requests.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma solicitação registrada.</p>
        )}
        {requests.map((req) => (
          <div key={req.id} className="border rounded-lg p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <p className="font-medium">{fieldLabels[req.field_name] || req.field_name}</p>
              <Badge variant={req.status === 'approved' ? 'default' : req.status === 'pending' ? 'secondary' : 'destructive'}>
                {req.status === 'approved' ? 'Aprovado' : req.status === 'pending' ? 'Pendente' : 'Rejeitado'}
              </Badge>
            </div>
            <p className="text-muted-foreground line-through text-xs">
              {req.old_value || '(vazio)'}
            </p>
            <p className="text-foreground">{req.new_value}</p>
            <p className="text-[10px] text-muted-foreground">
              Enviado em {new Date(req.created_at).toLocaleString('pt-BR')}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
