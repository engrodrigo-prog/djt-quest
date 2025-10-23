import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Target, Zap, Trophy, Users } from 'lucide-react';
import { TeamPerformanceManager } from '@/components/TeamPerformanceManager';
import { ChallengeForm } from '@/components/ChallengeForm';
import { CampaignForm } from '@/components/CampaignForm';
import Navigation from '@/components/Navigation';

const Studio = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const loadUserRole = async () => {
      if (!user) return;

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (roleData) {
        setUserRole(roleData.role);
      }
      setLoading(false);
    };

    loadUserRole();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!userRole || !['admin', 'gerente', 'lider_divisao', 'coordenador'].includes(userRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Apenas gestores e líderes podem acessar o DJT Go Studio.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 pb-20 md:pb-8">
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-2">
            <Plus className="h-8 w-8 text-primary" />
            DJT Go Studio
          </h1>
          <p className="text-muted-foreground">Console de gestão de campanhas e desafios</p>
        </div>

        <Tabs defaultValue="campaigns" className="w-full">
          <TabsList className="grid w-full max-w-3xl grid-cols-4">
            <TabsTrigger value="campaigns">
              <Target className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Campanhas</span>
            </TabsTrigger>
            <TabsTrigger value="challenges">
              <Zap className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Desafios</span>
            </TabsTrigger>
            <TabsTrigger value="performance">
              <Trophy className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Performance</span>
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Usuários</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="space-y-4">
            <CampaignForm />
          </TabsContent>

          <TabsContent value="challenges" className="space-y-4">
            <ChallengeForm />
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <TeamPerformanceManager />
          </TabsContent>

          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Gestão de Usuários</CardTitle>
                <CardDescription>
                  Crie, edite e gerencie usuários da plataforma
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-center py-12">
                  Em desenvolvimento - CRUD de usuários em breve
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Navigation />
    </div>
  );
};

export default Studio;