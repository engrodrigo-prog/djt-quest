import { useAuth } from '@/contexts/AuthContext';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Target, Zap, HelpCircle, TrendingUp, Award, Users, MessageSquare, ActivitySquare, Crown } from 'lucide-react';
import { TeamPerformanceManager } from '@/components/TeamPerformanceManager';
import { ChallengeForm } from '@/components/ChallengeForm';
import { CampaignForm } from '@/components/CampaignForm';
import Navigation from '@/components/Navigation';
import { UserCreationForm } from '@/components/UserCreationForm';
import { ForumManagement } from '@/components/ForumManagement';
import { TeamEventForm } from '@/components/TeamEventForm';
import { SystemHealthCheck } from '@/components/SystemHealthCheck';
import { QuizCreationWizard } from '@/components/QuizCreationWizard';
import { AdminBonusManager } from '@/components/AdminBonusManager';

const Studio = () => {
  const { user, loading, isLeader, studioAccess, userRole } = useAuth();
  const isGerenteDJT = userRole === 'gerente_djt';

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
            <TabsList className={`grid w-full max-w-6xl ${isGerenteDJT ? 'grid-cols-9' : 'grid-cols-8'}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="campaigns" className="flex flex-col items-center gap-1 py-2">
                    <Target className="h-4 w-4" />
                    <span className="text-[10px] sm:text-xs">Campanhas</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">Campanhas</p>
                  <p className="text-xs">Criar e gerenciar campanhas temáticas</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="quiz" className="flex flex-col items-center gap-1 py-2">
                    <HelpCircle className="h-4 w-4" />
                    <span className="text-[10px] sm:text-xs">Quiz</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">Quiz de Conhecimento</p>
                  <p className="text-xs">Criar perguntas com alternativas e XP por acerto</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="challenges" className="flex flex-col items-center gap-1 py-2">
                    <Zap className="h-4 w-4" />
                    <span className="text-[10px] sm:text-xs">Desafios</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">Desafios</p>
                  <p className="text-xs">Criar outros tipos de desafios (fórum, mentoria, etc)</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="performance" className="flex flex-col items-center gap-1 py-2">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-[10px] sm:text-xs">Performance</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">Performance</p>
                  <p className="text-xs">Monitorar e ajustar métricas das equipes</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="team-events" className="flex flex-col items-center gap-1 py-2">
                    <Award className="h-4 w-4" />
                    <span className="text-[10px] sm:text-xs">Bonificação</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">Bonificação de Equipe</p>
                  <p className="text-xs">Reconhecimentos e pontos de atenção</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="users" className="flex flex-col items-center gap-1 py-2">
                    <Users className="h-4 w-4" />
                    <span className="text-[10px] sm:text-xs">Usuários</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">Usuários</p>
                  <p className="text-xs">Criar e gerenciar colaboradores</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="forums" className="flex flex-col items-center gap-1 py-2">
                    <MessageSquare className="h-4 w-4" />
                    <span className="text-[10px] sm:text-xs">Fóruns</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">Fóruns</p>
                  <p className="text-xs">Moderar tópicos e posts do fórum</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="system" className="flex flex-col items-center gap-1 py-2">
                    <ActivitySquare className="h-4 w-4" />
                    <span className="text-[10px] sm:text-xs">Sistema</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">Sistema</p>
                  <p className="text-xs">Diagnóstico e verificação de integridade</p>
                </TooltipContent>
              </Tooltip>

              {isGerenteDJT && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="admin" className="flex flex-col items-center gap-1 py-2 border-l-2 border-amber-500/50">
                      <Crown className="h-4 w-4 text-amber-500" />
                      <span className="text-[10px] sm:text-xs text-amber-500">Admin</span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-semibold">Admin Global</p>
                    <p className="text-xs">Bonificação para qualquer equipe (Gerente DJT)</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </TabsList>
          </TooltipProvider>

          <TabsContent value="campaigns" className="space-y-4">
            <CampaignForm />
          </TabsContent>

          <TabsContent value="quiz" className="space-y-4">
            <QuizCreationWizard />
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

          {isGerenteDJT && (
            <TabsContent value="admin" className="space-y-4">
              <AdminBonusManager />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <Navigation />
    </div>
  );
};

export default Studio;
