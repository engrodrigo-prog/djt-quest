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
import { UserCreationForm } from '@/components/UserCreationForm';
import { ForumManagement } from '@/components/ForumManagement';
import { TeamEventForm } from '@/components/TeamEventForm';
import { SystemHealthCheck } from '@/components/SystemHealthCheck';
import { QuizCreationWizard } from '@/components/QuizCreationWizard';
import { AdminBonusManager } from '@/components/AdminBonusManager';
import { PendingRegistrationsManager } from '@/components/PendingRegistrationsManager';
import { UserManagement } from '@/components/UserManagement';
import EvaluationManagement from '@/components/EvaluationManagement';

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

  // Se nenhum módulo selecionado, mostra dashboard
  if (!selectedModule) {
    return (
      <>
        <StudioDashboard onSelectModule={setSelectedModule} userRole={userRole} />
        <Navigation />
      </>
    );
  }

  // Renderiza módulo selecionado
  const renderModule = () => {
    switch (selectedModule) {
      case 'campaigns':
        return <CampaignForm />;
      case 'quiz':
        return <QuizCreationWizard />;
      case 'challenges':
        return <ChallengeForm />;
      case 'performance':
        return <TeamPerformanceManager />;
      case 'team-bonus':
        return <TeamEventForm />;
      case 'user-management':
        return <UserManagement />;
      case 'evaluations':
        return <EvaluationManagement />;
      case 'users':
        return <UserCreationForm />;
      case 'registrations':
        return <PendingRegistrationsManager />;
      case 'forums':
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
    <div className="min-h-screen bg-background pb-20 md:pb-8">
      <div className="container mx-auto p-4 md:p-8 max-w-7xl space-y-6">
        {/* Botão Voltar */}
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

        {/* Renderiza módulo selecionado com animação */}
        <div className="animate-in fade-in duration-300">
          {renderModule()}
        </div>
      </div>

      <Navigation />
    </div>
  );
};

export default Studio;
