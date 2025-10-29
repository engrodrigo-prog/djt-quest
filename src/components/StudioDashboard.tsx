import { 
  Target, 
  HelpCircle, 
  Zap, 
  TrendingUp, 
  Award, 
  UserPlus, 
  MessageSquare, 
  ActivitySquare,
  Crown,
  ChevronRight
} from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StudioModule {
  id: string;
  title: string;
  description: string;
  icon: typeof Target;
  gradientFrom: string;
  gradientTo: string;
  requiredRole?: string;
  badge?: number;
}

interface StudioDashboardProps {
  onSelectModule: (moduleId: string) => void;
  userRole?: string;
}

export const StudioDashboard = ({ onSelectModule, userRole }: StudioDashboardProps) => {
  const modules: StudioModule[] = [
    {
      id: 'campaigns',
      title: 'Campanhas',
      description: 'Criar e gerenciar campanhas temáticas',
      icon: Target,
      gradientFrom: 'from-djt-blue-medium',
      gradientTo: 'to-djt-blue-dark',
    },
    {
      id: 'quiz',
      title: 'Quiz',
      description: 'Perguntas com alternativas e XP por acerto',
      icon: HelpCircle,
      gradientFrom: 'from-primary',
      gradientTo: 'to-djt-blue-dark',
    },
    {
      id: 'challenges',
      title: 'Desafios',
      description: 'Fórum, mentoria, inspeção e atitude',
      icon: Zap,
      gradientFrom: 'from-accent',
      gradientTo: 'to-djt-orange',
    },
    {
      id: 'performance',
      title: 'Performance',
      description: 'Acompanhar resultados de equipes',
      icon: TrendingUp,
      gradientFrom: 'from-secondary',
      gradientTo: 'to-djt-blue-medium',
    },
    {
      id: 'team-bonus',
      title: 'Bonificação',
      description: 'Reconhecimentos e pontos de atenção',
      icon: Award,
      gradientFrom: 'from-djt-yellow',
      gradientTo: 'to-accent',
    },
    {
      id: 'users',
      title: 'Usuários',
      description: 'Criar e gerenciar usuários do sistema',
      icon: UserPlus,
      gradientFrom: 'from-djt-blue-dark',
      gradientTo: 'to-primary',
    },
    {
      id: 'forums',
      title: 'Fóruns',
      description: 'Gerenciar categorias e moderação',
      icon: MessageSquare,
      gradientFrom: 'from-muted-foreground',
      gradientTo: 'to-djt-blue-medium',
    },
    {
      id: 'system',
      title: 'Sistema',
      description: 'Diagnóstico e status do sistema',
      icon: ActivitySquare,
      gradientFrom: 'from-border',
      gradientTo: 'to-muted',
    },
    {
      id: 'admin',
      title: 'Admin',
      description: 'Bonificar qualquer equipe (Gerente)',
      icon: Crown,
      gradientFrom: 'from-djt-orange',
      gradientTo: 'to-djt-yellow',
      requiredRole: 'gerente_djt',
    },
  ];

  const visibleModules = modules.filter(
    (module) => !module.requiredRole || module.requiredRole === userRole
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">DJT Quest Studio</h1>
          <p className="text-muted-foreground text-lg">
            Console de gestão | Modo Líder
          </p>
        </div>

        {/* Grid de Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleModules.map((module) => {
            const Icon = module.icon;
            return (
              <Card
                key={module.id}
                className="relative overflow-hidden cursor-pointer group hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 border-border"
                onClick={() => onSelectModule(module.id)}
              >
                {/* Badge de contagem (opcional) */}
                {module.badge && module.badge > 0 && (
                  <Badge className="absolute top-3 right-3 z-10 bg-destructive text-destructive-foreground">
                    {module.badge}
                  </Badge>
                )}

                {/* Ícone com gradiente */}
                <div className={`bg-gradient-to-br ${module.gradientFrom} ${module.gradientTo} p-6 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="h-10 w-10 text-white" strokeWidth={1.5} />
                </div>

                {/* Conteúdo */}
                <CardHeader className="pb-6">
                  <CardTitle className="text-2xl mb-2 text-card-foreground">{module.title}</CardTitle>
                  <CardDescription className="text-base text-muted-foreground">
                    {module.description}
                  </CardDescription>
                </CardHeader>

                {/* Indicador visual de "clicável" */}
                <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <ChevronRight className="h-6 w-6 text-primary" />
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};
