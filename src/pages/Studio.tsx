import { useAuth } from '@/contexts/AuthContext';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Target, Zap, Trophy, Users, MessageSquare, Gift, Settings } from 'lucide-react';
import { TeamPerformanceManager } from '@/components/TeamPerformanceManager';
import { ChallengeForm } from '@/components/ChallengeForm';
import { CampaignForm } from '@/components/CampaignForm';
import Navigation from '@/components/Navigation';
import { UserCreationForm } from '@/components/UserCreationForm';
import { ForumManagement } from '@/components/ForumManagement';
import { TeamEventForm } from '@/components/TeamEventForm';
import { SystemHealthCheck } from '@/components/SystemHealthCheck';

const Studio = () => {
  const { user, loading, isLeader, studioAccess } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Verificando permissões...</p>
        </div>
      </div>
    );
  }

  if (!isLeader || !studioAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Seu perfil atual não possui permissão para acessar o DJT Quest Studio. Entre como Coordenador, Líder ou Gerente.
            </CardDescription>
          </CardHeader>
        </Card>
        <Navigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 pb-20 md:pb-8">
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-2">
            <Plus className="h-8 w-8 text-primary" />
            DJT Quest Studio
          </h1>
          <p className="text-muted-foreground">
            Console de gestão de campanhas e desafios | Modo Líder
          </p>
        </div>

        <Tabs defaultValue="campaigns" className="w-full">
          <TooltipProvider>
            <TabsList className="grid w-full max-w-5xl grid-cols-7">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="campaigns">
                    <Target className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Campanhas</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Criar e gerenciar campanhas temáticas</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="challenges">
                    <Zap className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Desafios</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Criar desafios e definir pontuações</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="performance">
                    <Trophy className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Performance</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Monitorar métricas das equipes</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="team-events">
                    <Gift className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Equipe</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Criar eventos e reconhecimentos</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="users">
                    <Users className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Usuários</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Criar e gerenciar colaboradores</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="forums">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Fóruns</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Moderar tópicos e posts do fórum</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="system">
                    <Settings className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Sistema</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Popular dados e diagnóstico</p>
                </TooltipContent>
              </Tooltip>
            </TabsList>
          </TooltipProvider>

          <TabsContent value="campaigns" className="space-y-4">
            <CampaignForm />
          </TabsContent>

          <TabsContent value="challenges" className="space-y-4">
            <ChallengeForm />
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <TeamPerformanceManager />
          </TabsContent>

          <TabsContent value="team-events" className="space-y-4">
            <TeamEventForm />
          </TabsContent>

          <TabsContent value="users" className="space-y-4">
            <UserCreationForm />
          </TabsContent>

          <TabsContent value="forums" className="space-y-4">
            <ForumManagement />
          </TabsContent>

          <TabsContent value="system" className="space-y-4">
            <SystemHealthCheck />
          </TabsContent>
        </Tabs>
      </div>

      <Navigation />
    </div>
  );
};

export default Studio;
