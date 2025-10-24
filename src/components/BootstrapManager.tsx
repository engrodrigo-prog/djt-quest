import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Shield } from 'lucide-react';

export const BootstrapManager = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

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

  return (
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
  );
};
