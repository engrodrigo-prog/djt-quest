import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface HealthCheckResult {
  email: string;
  exists: boolean;
  is_leader: boolean | null;
  studio_access: boolean | null;
  tier: string | null;
  has_role: boolean;
  role_name: string | null;
}

export const SystemHealthCheck = () => {
  const [health, setHealth] = useState<HealthCheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  const checkSystem = async () => {
    setChecking(true);
    
    try {
      const testEmails = [
        'colab@teste.com',
        'coordenador@teste.com',
        'gerente-divisao@teste.com',
        'gerente-dept@teste.com'
      ];

      // Buscar profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('email, is_leader, studio_access, tier')
        .in('email', testEmails);

      // Buscar roles
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role, profiles!inner(email)')
        .in('profiles.email', testEmails);

      // Consolidar resultados
      const results: HealthCheckResult[] = testEmails.map(email => {
        const profile = profiles?.find(p => p.email === email);
        const roleData = roles?.find(r => (r.profiles as any)?.email === email);

        return {
          email,
          exists: !!profile,
          is_leader: profile?.is_leader ?? null,
          studio_access: profile?.studio_access ?? null,
          tier: profile?.tier ?? null,
          has_role: !!roleData,
          role_name: roleData?.role ?? null
        };
      });

      setHealth(results);
    } catch (error) {
      console.error('Error checking system health:', error);
      setHealth([]);
    } finally {
      setChecking(false);
    }
  };

  const getStatusIcon = (user: HealthCheckResult) => {
    if (!user.exists) return <XCircle className="h-4 w-4 text-destructive" />;
    if (user.email === 'colab@teste.com') {
      // Colaborador não deve ser líder
      if (!user.is_leader && user.has_role) {
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      }
    } else {
      // Líderes devem ter is_leader e studio_access
      if (user.is_leader && user.studio_access && user.has_role) {
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      }
    }
    return <AlertCircle className="h-4 w-4 text-yellow-500" />;
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Diagnóstico do Sistema
            </CardTitle>
            <CardDescription>
              Verificar integridade dos usuários de teste
            </CardDescription>
          </div>
          <Button 
            onClick={checkSystem} 
            disabled={checking}
            variant="outline"
            size="sm"
          >
            {checking ? 'Verificando...' : 'Verificar'}
          </Button>
        </div>
      </CardHeader>
      
      {health && (
        <CardContent>
          <div className="space-y-3">
            {health.map((user) => (
              <div 
                key={user.email}
                className="flex items-start justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-start gap-3 flex-1">
                  {getStatusIcon(user)}
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{user.email}</span>
                      {user.exists && (
                        <Badge variant="outline" className="text-xs">
                          {user.tier}
                        </Badge>
                      )}
                    </div>
                    
                    {user.exists ? (
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>Role: {user.role_name || 'Nenhuma'}</div>
                        <div>Líder: {user.is_leader ? 'Sim' : 'Não'}</div>
                        <div>Acesso Studio: {user.studio_access ? 'Sim' : 'Não'}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-destructive">
                        Usuário não encontrado
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-muted text-xs space-y-1">
            <div className="font-semibold">Legenda:</div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              <span>Configurado corretamente</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-3 w-3 text-yellow-500" />
              <span>Configuração incompleta</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-3 w-3 text-destructive" />
              <span>Usuário não existe</span>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
};
