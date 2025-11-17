import { 
  Target, 
  TrendingUp, 
  Award, 
  ActivitySquare,
  Crown,
  ChevronRight,
  Users,
  ClipboardCheck,
  Key,
  AlertCircle,
} from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { apiFetch, apiBaseUrl } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { gameTips } from "@/content/game-tips";

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

  useEffect(() => {
    let active = true;

    const fetchCounts = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid || !active) {
          if (active) {
            setBadges({
              approvals: 0,
              passwordResets: 0,
              evaluations: 0,
              forumMentions: 0,
              registrations: 0,
            });
          }
          return;
        }

        const q = (tbl: string, filter: (rq: any) => any) =>
          filter(supabase.from(tbl)).select('id', { count: 'exact', head: true });

        const [ap, pr, rg, ev, la, fm] = await Promise.all([
          q('profile_change_requests', (rq) => rq.eq('status', 'pending')),
          q('password_reset_requests', (rq) => rq.eq('status', 'pending')),
          q('pending_registrations', (rq) => rq.eq('status', 'pending')),
          q('evaluation_queue', (rq) => rq.eq('assigned_to', uid).is('completed_at', null)),
          q('leadership_challenge_assignments', (rq) => rq.eq('user_id', uid).eq('status', 'assigned')),
          q('forum_mentions', (rq) => rq.eq('mentioned_user_id', uid).eq('is_read', false)),
        ] as any);

        if (active) {
          setBadges({
            approvals: ap?.count || 0,
            passwordResets: pr?.count || 0,
            registrations: rg?.count || 0,
            evaluations: (ev as any)?.count || 0,
            forumMentions: (fm as any)?.count || 0,
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
      id: 'content',
      title: 'Campanhas • Quizzes • Fóruns',
      description: 'Gerenciar conteúdos de engajamento',
      icon: Target,
      gradientFrom: 'from-djt-blue-medium',
      gradientTo: 'to-djt-blue-dark',
    },
    {
      id: 'user-management',
      title: 'Gerenciar Usuários',
      description: 'Criar, editar e limpar usuários',
      icon: Users,
      gradientFrom: 'from-primary',
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
      id: 'team-bonus',
      title: 'Bonificação',
      description: 'Reconhecimentos e pontos de atenção',
      icon: Award,
      gradientFrom: 'from-djt-yellow',
      gradientTo: 'to-accent',
    },
    {
      id: 'user-approvals',
      title: 'Cadastros & Aprovações',
      description: 'Aprovar cadastros e mudanças de perfil',
      icon: ClipboardCheck,
      gradientFrom: 'from-emerald-500',
      gradientTo: 'to-green-600',
      badge: (badges.approvals || 0) + (badges.registrations || 0),
    },
    {
      id: 'password-resets',
      title: 'Reset de Senha',
      description: 'Aprovar solicitações de redefinição',
      icon: Key,
      gradientFrom: 'from-slate-500',
      gradientTo: 'to-slate-900',
      badge: badges.passwordResets,
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
    <div className="min-h-screen bg-transparent p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-blue-50 mb-1">
            DJT Quest Studio
          </h1>
          <p className="text-blue-100/80 text-sm md:text-base">
            Console de gestão | Modo Líder
          </p>
        </div>

        {/* Grid de Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleModules.map((module) => {
            const Icon = module.icon;
            const tipKey = `studio-${module.id}` as keyof typeof gameTips;
            return (
              <Card
                key={`module-${module.id}`}
                className="relative overflow-hidden cursor-pointer group hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 border-cyan-800/40 bg-white/5"
                onClick={() => onSelectModule(module.id)}
              >
                {/* Badge de contagem (opcional) */}
                {typeof module.badge !== 'undefined' && (
                  <Badge className={`absolute top-3 right-3 z-10 ${module.badge >= 1 ? 'bg-destructive text-destructive-foreground' : 'bg-green-600 text-white'}`}>
                    {module.badge > 99 ? '99+' : module.badge}
                  </Badge>
                )}

                {/* Ícone com gradiente */}
                <div className={`bg-gradient-to-br ${module.gradientFrom} ${module.gradientTo} p-4 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="h-8 w-8 text-white" strokeWidth={1.5} />
                </div>

                {/* Conteúdo */}
                <CardHeader className="pb-4 pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg mb-1 text-blue-50">{module.title}</CardTitle>
                    <button
                      type="button"
                      aria-label={`Entenda ${module.title}`}
                      className="mt-0.5 inline-flex items-center justify-center rounded-full border border-cyan-500/60 bg-black/40 p-1 text-cyan-200 hover:bg-cyan-500/20 hover:text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfoId(tipKey);
                        setInfoOpen(true);
                      }}
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <CardDescription className="text-xs text-blue-100/80">
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
