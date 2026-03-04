import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Navigation from '@/components/Navigation';
// 'Criar Usuário' será acessado dentro de Gerenciar Usuários
import { ThemedBackground } from '@/components/ThemedBackground';
import { useI18n } from '@/contexts/I18nContext';

const StudioDashboard = lazy(() =>
  import('@/components/StudioDashboard').then((mod) => ({ default: mod.StudioDashboard })),
);
const TeamPerformanceManager = lazy(() =>
  import('@/components/TeamPerformanceManager').then((mod) => ({ default: mod.TeamPerformanceManager })),
);
const ChallengeForm = lazy(() =>
  import('@/components/ChallengeForm').then((mod) => ({ default: mod.ChallengeForm })),
);
const CampaignForm = lazy(() =>
  import('@/components/CampaignForm').then((mod) => ({ default: mod.CampaignForm })),
);
const ForumManagement = lazy(() =>
  import('@/components/ForumManagement').then((mod) => ({ default: mod.ForumManagement })),
);
const TeamEventForm = lazy(() =>
  import('@/components/TeamEventForm').then((mod) => ({ default: mod.TeamEventForm })),
);
const SystemHealthCheck = lazy(() =>
  import('@/components/SystemHealthCheck').then((mod) => ({ default: mod.SystemHealthCheck })),
);
const QuizCreationWizard = lazy(() =>
  import('@/components/QuizCreationWizard').then((mod) => ({ default: mod.QuizCreationWizard })),
);
const AiQuizGenerator = lazy(() =>
  import('@/components/AiQuizGenerator').then((mod) => ({ default: mod.AiQuizGenerator })),
);
const AdminBonusManager = lazy(() =>
  import('@/components/AdminBonusManager').then((mod) => ({ default: mod.AdminBonusManager })),
);
const EvaluationManagement = lazy(() => import('@/components/EvaluationManagement'));
const ContentHub = lazy(() =>
  import('@/components/ContentHub').then((mod) => ({ default: mod.ContentHub })),
);
const UserApprovalsHub = lazy(() =>
  import('@/components/UserApprovalsHub').then((mod) => ({ default: mod.UserApprovalsHub })),
);
const CampaignManagement = lazy(() =>
  import('@/components/CampaignManagement').then((mod) => ({ default: mod.CampaignManagement })),
);
const ChallengeManagement = lazy(() =>
  import('@/components/ChallengeManagement').then((mod) => ({ default: mod.ChallengeManagement })),
);
const StudyLab = lazy(() =>
  import('@/components/StudyLab').then((mod) => ({ default: mod.StudyLab })),
);
const StudioMaintenance = lazy(() =>
  import('@/components/StudioMaintenance').then((mod) => ({ default: mod.StudioMaintenance })),
);
const ReportsHub = lazy(() =>
  import('@/components/ReportsHub').then((mod) => ({ default: mod.ReportsHub })),
);
const FinanceRequestsManagement = lazy(() =>
  import('@/components/FinanceRequestsManagement').then((mod) => ({ default: mod.FinanceRequestsManagement })),
);

const Studio = () => {
  const { loading, studioAccess, userRole, roleOverride } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Curadores: Studio é apenas o HUB de Curadoria
    if (!loading && studioAccess && userRole === 'content_curator') {
      navigate('/studio/curadoria', { replace: true });
    }
  }, [loading, studioAccess, userRole, navigate]);

  const allowedModules = useMemo(() => {
    if (userRole === 'analista_financeiro') {
      return new Set(['finance']);
    }

    return new Set([
      'content',
      'campaigns',
      'campaigns-manage',
      'quiz',
      'quiz-manage',
      'challenges',
      'challenges-manage',
      'performance',
      'ai-quiz',
      'study-lab',
      'maintenance',
      'team-bonus',
      'evaluations',
      'user-approvals',
      'forums',
      'forums-manage',
      'reports',
      'finance',
      'system',
      'admin',
    ]);
  }, [userRole]);

  const selectedModule = useMemo(() => {
    if (loading || !studioAccess || userRole === 'content_curator') return null;

    const params = new URLSearchParams(location.search);
    const moduleParam = (params.get('module') || '').trim();
    if (!moduleParam) return null;
    if (!allowedModules.has(moduleParam)) return null;
    return moduleParam;
  }, [allowedModules, loading, location.search, studioAccess, userRole]);

  const openModule = useCallback((moduleId: string) => {
    const nextParams = new URLSearchParams();
    nextParams.set('module', moduleId);
    const nextSearch = `?${nextParams.toString()}`;
    if (location.search === nextSearch) return;
    navigate({ pathname: location.pathname, search: nextSearch });
  }, [location.pathname, location.search, navigate]);

  const closeModule = useCallback(() => {
    if (!location.search) return;
    navigate({ pathname: location.pathname, search: '' });
  }, [location.pathname, location.search, navigate]);

  const moduleFallback = (
    <div className="flex min-h-[240px] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">{t("studio.checkingPermissions")}</p>
        </div>
      </div>
    );
  }

  if (!studioAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{t("studio.accessDeniedTitle")}</CardTitle>
            <CardDescription>
              {t("studio.accessDeniedBase")}{" "}
              {roleOverride ? t("studio.accessDeniedTestSuffix") : t("studio.accessDeniedHintSuffix")}
            </CardDescription>
          </CardHeader>
        </Card>
        <Navigation />
      </div>
    );
  }

  if (userRole === 'content_curator') {
    return null;
  }

  // Renderiza conteúdo do Studio (dashboard inicial ou módulo selecionado)
  const renderModule = () => {
    switch (selectedModule) {
      case 'content':
        return <ContentHub onOpen={openModule} />;
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
      case 'ai-quiz':
        return <AiQuizGenerator />;
      case 'study-lab':
        return <StudyLab />;
      case 'maintenance':
        return <StudioMaintenance />;
      case 'team-bonus':
        return <TeamEventForm />;
      case 'evaluations':
        return <EvaluationManagement />;
      case 'user-approvals':
        return <UserApprovalsHub />;
      case 'forums':
        return <ForumManagement />;
      case 'forums-manage':
        return <ForumManagement />;
      case 'reports':
        return <ReportsHub />;
      case 'finance':
        return <FinanceRequestsManagement />;
      case 'system':
        return <SystemHealthCheck />;
      case 'admin':
        return userRole === 'gerente_djt' || userRole === 'admin' ? <AdminBonusManager /> : null;
      default:
        return null;
    }
  };

  return (
    <div className="relative min-h-screen bg-transparent pb-40 overflow-x-hidden">
      <ThemedBackground theme="seguranca" />
      <div className="container relative mx-auto p-4 md:p-8 max-w-7xl space-y-6">
        {/* Se nenhum módulo for escolhido, mostra o dashboard. Caso contrário, mostra o módulo e um voltar. */}
        {selectedModule ? (
          <>
            <div>
              <Button
                onClick={closeModule}
                variant="ghost"
                className="gap-2 hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("studio.backToStudio")}
              </Button>
            </div>
            <div className="animate-in fade-in duration-300">
              <Suspense fallback={moduleFallback}>{renderModule()}</Suspense>
            </div>
          </>
        ) : (
          <Suspense fallback={moduleFallback}>
            <StudioDashboard onSelectModule={openModule} userRole={userRole} />
          </Suspense>
        )}
      </div>

      <Navigation />
    </div>
  );
};

export default Studio;
