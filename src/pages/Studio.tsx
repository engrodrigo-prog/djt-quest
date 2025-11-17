import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { StudioDashboard } from '@/components/StudioDashboard';
import { TeamPerformanceManager } from '@/components/TeamPerformanceManager';
import { ChallengeForm } from '@/components/ChallengeForm';
import { CampaignForm } from '@/components/CampaignForm';
import Navigation from '@/components/Navigation';
// 'Criar Usuário' será acessado dentro de Gerenciar Usuários
import { ForumManagement } from '@/components/ForumManagement';
import { TeamEventForm } from '@/components/TeamEventForm';
import { SystemHealthCheck } from '@/components/SystemHealthCheck';
import { QuizCreationWizard } from '@/components/QuizCreationWizard';
import { AdminBonusManager } from '@/components/AdminBonusManager';
import { PendingRegistrationsManager } from '@/components/PendingRegistrationsManager';
import { UserManagement } from '@/components/UserManagement';
import EvaluationManagement from '@/components/EvaluationManagement';
import { PendingApprovals } from '@/components/PendingApprovals';
import { ThemedBackground } from '@/components/ThemedBackground';
import { AiQuizGenerator } from '@/components/AiQuizGenerator';
import { PasswordResetManager } from '@/components/PasswordResetManager';
import { ContentHub } from '@/components/ContentHub';
import { UserApprovalsHub } from '@/components/UserApprovalsHub';
import { CampaignManagement } from '@/components/CampaignManagement';
import { ChallengeManagement } from '@/components/ChallengeManagement';

const Studio = () => {
  const { user, loading, isLeader, studioAccess, userRole } = useAuth();
  const [selectedModule, setSelectedModule] = useState<string | null>(null);

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

  // Renderiza conteúdo do Studio (dashboard inicial ou módulo selecionado)
  const renderModule = () => {
  switch (selectedModule) {
      case 'content':
        return <ContentHub onOpen={(id) => setSelectedModule(id)} />;
      case 'campaigns':
        return <CampaignForm />;
      case 'campaigns-manage':
        return <CampaignManagement />;
      case 'quiz':
        return <QuizCreationWizard />;
      case 'quiz-manage':
        return <ChallengeManagement onlyQuizzes />;
      case 'challenges':
        return <ChallengeForm />;
      case 'challenges-manage':
        return <ChallengeManagement />;
      case 'performance':
        return <TeamPerformanceManager />;
      case 'team-bonus':
        return <TeamEventForm />;
      case 'user-management':
        return <UserManagement />;
      case 'evaluations':
        return <EvaluationManagement />;
      case 'user-approvals':
        return <UserApprovalsHub />;
      case 'password-resets':
        return <PasswordResetManager />;
      case 'forums':
        return <ForumManagement />;
      case 'forums-manage':
        return <ForumManagement />;
      case 'system':
        return <SystemHealthCheck />;
      case 'admin':
        return userRole === 'gerente_djt' ? <AdminBonusManager /> : null;
      default:
        return null;
    }
  };

  return (
    <div className="relative min-h-screen bg-transparent pb-40 md:pb-20 overflow-hidden">
      <ThemedBackground theme="seguranca" />
      <div className="container relative mx-auto p-4 md:p-8 max-w-7xl space-y-6">
        {/* Se nenhum módulo for escolhido, mostra o dashboard. Caso contrário, mostra o módulo e um voltar. */}
        {selectedModule ? (
          <>
            <div>
              <Button
                onClick={() => setSelectedModule(null)}
                variant="ghost"
                className="gap-2 hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar ao Studio
              </Button>
            </div>
            <div className="animate-in fade-in duration-300">
              {renderModule()}
            </div>
          </>
        ) : (
          <StudioDashboard onSelectModule={setSelectedModule} userRole={userRole} />
        )}
      </div>

      <Navigation />
    </div>
  );
};

export default Studio;
