import { 
  Target, 
  TrendingUp, 
  Award, 
  ActivitySquare,
  Crown,
  BarChart3,
  ChevronRight,
  ClipboardCheck,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { gameTips } from "@/content/game-tips";
import { useNavigate } from "react-router-dom";

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
  const [badges, setBadges] = useState<{ approvals: number; passwordResets: number; evaluations: number; forumMentions: number; registrations: number }>({ approvals: 0, passwordResets: 0, evaluations: 0, forumMentions: 0, registrations: 0 });
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoId, setInfoId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const fetchCounts = async () => {
      try {
        const resp = await apiFetch('/api/admin?handler=studio-pending-counts');
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || 'Falha nas contagens');

        if (active) {
          setBadges({
            approvals: json?.approvals || 0,
            passwordResets: json?.passwordResets || 0,
            registrations: json?.registrations || 0,
            evaluations: json?.evaluations || 0,
            forumMentions: json?.forumMentions || 0,
          });
        }
      } catch {
        if (active) {
          setBadges({
            approvals: 0,
            passwordResets: 0,
            evaluations: 0,
            forumMentions: 0,
            registrations: 0,
          });
        }
      }
    };

    fetchCounts();
    const timer = setInterval(fetchCounts, 30000);
    const onFocus = () => fetchCounts();
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchCounts(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const modules: StudioModule[] = [
    {
      id: 'curation',
      title: 'Curadoria de Conteúdo',
      description: 'Submeter, revisar e publicar quizzes',
      icon: ClipboardCheck,
      gradientFrom: 'from-emerald-500',
      gradientTo: 'to-emerald-800',
      badge: badges.approvals || 0,
    },
    {
      id: 'content',
      title: 'Campanhas • Quizzes • Fóruns',
      description: 'Gerenciar conteúdos de engajamento',
      icon: Target,
      gradientFrom: 'from-djt-blue-medium',
      gradientTo: 'to-djt-blue-dark',
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
      id: 'study-lab',
      title: 'Catálogo de Estudos (IA)',
      description: 'Enviar PDFs, links e vídeos para gerar quizzes',
      icon: ActivitySquare,
      gradientFrom: 'from-emerald-500',
      gradientTo: 'to-cyan-700',
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
      id: 'user-approvals',
      title: 'Gerenciar Usuários',
      description: 'Cadastros, aprovações e reset de senha',
      icon: ClipboardCheck,
      gradientFrom: 'from-emerald-500',
      gradientTo: 'to-green-600',
      badge: (badges.approvals || 0) + (badges.registrations || 0) + (badges.passwordResets || 0),
    },
    {
      id: 'evaluations',
      title: 'Avaliações',
      description: 'Gerenciar fila de avaliações',
      icon: ClipboardCheck,
      gradientFrom: 'from-purple-500',
      gradientTo: 'to-pink-500',
      badge: badges.evaluations,
    },
    {
      id: 'reports',
      title: 'Relatórios',
      description: 'Aderência, notas e acessos',
      icon: BarChart3,
      gradientFrom: 'from-cyan-600',
      gradientTo: 'to-sky-900',
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
      id: 'maintenance',
      title: 'Manutenção',
      description: 'Limpar sessão e uploads antigos',
      icon: Trash2,
      gradientFrom: 'from-slate-600',
      gradientTo: 'to-slate-900',
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
    (module) => !module.requiredRole || module.requiredRole === userRole || userRole === 'admin'
  );
  const finalModules = userRole === 'content_curator' ? visibleModules.filter((m) => m.id === 'curation') : visibleModules;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl md:text-4xl font-semibold leading-tight mb-1">
            DJT Quest Studio
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Console de gestão | Modo Líder
          </p>
        </div>

        {/* Grid de Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {finalModules.map((module) => {
            const Icon = module.icon;
            const tipKey = `studio-${module.id}` as keyof typeof gameTips;
            const badgeValue = typeof module.badge === 'number' ? module.badge : 0;
            return (
              <Card
                key={`module-${module.id}`}
                className="relative overflow-hidden cursor-pointer group hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 border border-border/70 bg-card"
                onClick={() => (module.id === 'curation' ? navigate('/studio/curadoria') : onSelectModule(module.id))}
                role="button"
                tabIndex={0}
                aria-label={`Abrir módulo ${module.title}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (module.id === 'curation') {
                      navigate('/studio/curadoria');
                    } else {
                      onSelectModule(module.id);
                    }
                  }
                }}
              >
                {/* Badge de contagem (opcional) */}
                {badgeValue > 0 && (
                  <Badge
                    className="absolute top-3 right-3 z-10"
                    variant="destructive"
                  >
                    {badgeValue > 99 ? '99+' : badgeValue}
                  </Badge>
                )}

                {/* Ícone com gradiente */}
                <div className={`bg-gradient-to-br ${module.gradientFrom} ${module.gradientTo} p-4 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="h-8 w-8 text-white" strokeWidth={1.5} />
                </div>

                {/* Conteúdo */}
                <CardHeader className="pb-4 pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg font-semibold leading-tight text-foreground mb-1">
                      {module.title}
                    </CardTitle>
                    <button
                      type="button"
                      aria-label={`Entenda ${module.title}`}
                      className="mt-0.5 inline-flex items-center justify-center rounded-full border border-border bg-muted/60 p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfoId(tipKey);
                        setInfoOpen(true);
                      }}
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
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
      <Dialog
        open={infoOpen}
        onOpenChange={(open) => {
          setInfoOpen(open);
          if (!open) setInfoId(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {infoId && gameTips[infoId]?.title
                ? gameTips[infoId].title
                : 'Sobre esta ferramenta'}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line text-sm">
              {infoId && gameTips[infoId]?.body
                ? gameTips[infoId].body
                : 'Atualize o arquivo src/content/game-tips.ts para descrever esta ferramenta, incluindo regras de XP e exemplos de uso.'}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
};
