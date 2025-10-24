import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Shield, Users, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const BootstrapManager = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResults, setSeedResults] = useState<any>(null);

  const handleBootstrap = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('bootstrap-first-manager');

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.message || 'Erro ao promover gerente');
      }

      toast({
        title: 'Sucesso!',
        description: data.message
      });

      // Reload to update permissions
      setTimeout(() => window.location.reload(), 1500);
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSeedTestUsers = async () => {
    setSeedLoading(true);
    setSeedResults(null);

    try {
      const { data, error } = await supabase.functions.invoke('seed-test-users');

      if (error) throw error;

      setSeedResults(data);

      toast({
        title: 'Usuários de teste criados!',
        description: `${data.results.filter((r: any) => r.status === 'created').length} usuários criados com sucesso.`
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao criar usuários',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSeedLoading(false);
    }
  };

  return (
    <div className="space-y-4">
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Bootstrap - Primeiro Gerente
        </CardTitle>
        <CardDescription>
          Se você não consegue acessar o Studio, clique aqui para se promover a gerente (apenas funciona se não houver outro gerente/admin no sistema)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleBootstrap} disabled={loading} variant="outline">
          {loading ? 'Promovendo...' : 'Promover a Gerente'}
        </Button>
      </CardContent>
    </Card>

    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Usuários de Teste
        </CardTitle>
        <CardDescription>
          Criar usuários de teste para experimentar o sistema com diferentes papéis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          onClick={handleSeedTestUsers} 
          disabled={seedLoading}
          className="w-full"
          variant="outline"
        >
          {seedLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Criando usuários...
            </>
          ) : (
            'Criar Usuários de Teste'
          )}
        </Button>

        {seedResults && (
          <Alert>
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-semibold">Resultados:</p>
                {seedResults.results.map((r: any) => (
                  <div key={r.email} className="text-sm">
                    <span className="font-mono">{r.email}</span>
                    {' - '}
                    <span className={r.status === 'created' ? 'text-green-600' : r.status === 'already_exists' ? 'text-yellow-600' : 'text-red-600'}>
                      {r.status === 'created' ? '✓ Criado' : r.status === 'already_exists' ? '⚠ Já existe' : '✗ Erro'}
                    </span>
                    {r.role && ` (${r.role})`}
                  </div>
                ))}
                <div className="mt-4 p-3 bg-muted rounded-md">
                  <p className="font-semibold text-sm mb-2">Credenciais de teste:</p>
                  <ul className="text-xs space-y-1 font-mono">
                    <li>• colab@teste.com / teste123 (Colaborador)</li>
                    <li>• coordenador@teste.com / teste123 (Coordenador)</li>
                    <li>• gerente-divisao@teste.com / teste123 (Gerente de Divisão)</li>
                    <li>• gerente-dept@teste.com / teste123 (Gerente de Departamento)</li>
                  </ul>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
    </div>
  );
};
