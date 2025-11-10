import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
//
import iconHome from '@/assets/backgrounds/home.png';
import iconRanking from '@/assets/backgrounds/Ranking.png';
import iconAvaliar from '@/assets/backgrounds/avaliar.png';
import iconForum from '@/assets/backgrounds/Forum.png';
import iconStudio from '@/assets/backgrounds/studio.png';
import iconProfile from '@/assets/backgrounds/perfil.png';
import iconLogout from '@/assets/backgrounds/SAIR.png';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiFetch, apiBaseUrl } from '@/lib/api';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';
import { supabase } from '@/integrations/supabase/client';
import bgMenu from '@/assets/backgrounds/BG Menu.png';

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { studioAccess, isLeader, signOut } = useAuth();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [studioBadge, setStudioBadge] = useState(0);
  const [evalBadge, setEvalBadge] = useState(0);
  const [forumBadge, setForumBadge] = useState(0);

  useEffect(() => {
    const handler = () => setPasswordDialogOpen(true);
    window.addEventListener('open-password-dialog', handler as any);
    return () => window.removeEventListener('open-password-dialog', handler as any);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: any;

    const fetchCounts = async () => {
      try {
        if (!studioAccess) { setStudioBadge(0); setEvalBadge(0); setForumBadge(0); return; }
        const canUseApi = !import.meta.env.DEV || (!!apiBaseUrl && apiBaseUrl.length > 0);
        if (canUseApi) {
          const resp = await apiFetch('/api/studio-pending-counts');
          const json = await resp.json();
          if (!resp.ok) throw new Error('api_failed');
          if (!active) return;
          // Studio: aprovações + resets + cadastros pendentes
          setStudioBadge((json.approvals || 0) + (json.passwordResets || 0) + (json.registrations || 0));
          setEvalBadge((json.evaluations || 0) + (json.leadershipAssignments || 0));
          setForumBadge(json.forumMentions || 0);
          return;
        }
        // Fallthrough to fallback
        throw new Error('skip_api_in_dev');
      } catch {
        // Fallback: compute directly via Supabase (client-side RLS)
        try {
          const { data: userData } = await supabase.auth.getUser();
          const uid = userData.user?.id;
          const q = (tbl: string, filter: (rq: any) => any) => filter(supabase.from(tbl)).select('id', { count: 'exact', head: true });
          const [ap, pr, rg, ev, la, fm] = await Promise.all([
            q('profile_change_requests', (rq) => rq.eq('status','pending')),
            q('password_reset_requests', (rq) => rq.eq('status','pending')),
            q('pending_registrations', (rq) => rq.eq('status','pending')),
            uid ? q('evaluation_queue', (rq) => rq.eq('assigned_to', uid).is('completed_at', null)) : Promise.resolve({ count: 0 }),
            uid ? q('leadership_challenge_assignments', (rq) => rq.eq('user_id', uid).eq('status','assigned')) : Promise.resolve({ count: 0 }),
            uid ? q('forum_mentions', (rq) => rq.eq('mentioned_user_id', uid).eq('is_read', false)) : Promise.resolve({ count: 0 }),
          ] as any);
          const approvals = ap?.count || 0;
          const passwordResets = pr?.count || 0;
          const registrations = rg?.count || 0;
          const evaluations = (ev as any)?.count || 0;
          const leadershipAssignments = (la as any)?.count || 0;
          const forumMentions = (fm as any)?.count || 0;
          setStudioBadge(approvals + passwordResets + registrations);
          setEvalBadge(evaluations + leadershipAssignments);
          setForumBadge(forumMentions);
        } catch {}
      }
    };

    const startPolling = () => {
      clearInterval(timer);
      timer = setInterval(fetchCounts, 30000); // 30s
    };

    fetchCounts();
    startPolling();

    const onFocus = () => fetchCounts();
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchCounts(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [studioAccess]);

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 min-h-[112px] bg-transparent"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      {/* Decorative background for the bottom bar (BG Menu.png), does not block clicks */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-80">
        <div className="absolute inset-0" style={{
          backgroundImage: `url(${bgMenu})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }} />
      </div>
      <div className="relative max-w-full px-3 flex items-center justify-between gap-3 py-0 overflow-x-auto overflow-y-visible min-h-[112px]">
        <Button
          variant={isActive('/dashboard') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="flex-col h-auto py-2"
          aria-label="Início"
        >
          <span className={`relative inline-flex items-center justify-center rounded-md h-[72px] w-[72px] sm:h-[84px] sm:w-[84px] md:h-[96px] md:w-[96px] ${isActive('/dashboard') ? 'ring-2 ring-cyan-300/50 shadow-[0_0_10px_rgba(0,255,255,0.08)] scale-105' : 'ring-1 ring-transparent/0'} transition-transform duration-150 hover:scale-105 active:scale-110`}>
            <img src={iconHome} alt="Início" className="max-h-full max-w-full object-contain"/>
          </span>
        </Button>
        
        <Button
          variant={isActive('/rankings') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/rankings')}
          className="flex-col h-auto py-2"
          aria-label="Rankings"
        >
          <span className={`relative inline-flex items-center justify-center rounded-md h-[72px] w-[72px] sm:h-[84px] sm:w-[84px] md:h-[96px] md:w-[96px] ${isActive('/rankings') ? 'ring-2 ring-cyan-300/50 shadow-[0_0_10px_rgba(0,255,255,0.08)] scale-105' : 'ring-1 ring-transparent/0'} transition-transform duration-150 hover:scale-105 active:scale-110`}>
            <img src={iconRanking} alt="Rankings" className="max-h-full max-w-full object-contain" />
          </span>
        </Button>
        
        <Button
          variant={location.pathname.startsWith('/forum') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/forums')}
          className="flex-col h-auto py-2 relative"
          aria-label="Fóruns"
        >
          <span className={`relative inline-flex items-center justify-center rounded-md h-[72px] w-[72px] sm:h-[84px] sm:w-[84px] md:h-[96px] md:w-[96px] ${location.pathname.startsWith('/forum') ? 'ring-2 ring-cyan-300/50 shadow-[0_0_10px_rgba(0,255,255,0.08)] scale-105' : 'ring-1 ring-transparent/0'} transition-transform duration-150 hover:scale-105 active:scale-110`}>
            <img src={iconForum} alt="Fóruns" className="max-h-full max-w-full object-contain" />
            <span
              className={`absolute -top-1 -right-1 text-white text-[10px] leading-none rounded-full px-1.5 py-0.5 ${forumBadge >= 1 ? 'bg-red-600' : 'bg-green-600'}`}
            >
              {forumBadge > 99 ? '99+' : forumBadge}
            </span>
          </span>
        </Button>
        
        {isLeader && (
          <Button
            variant={isActive('/evaluations') ? 'default' : 'ghost'}
            size="sm"
            onClick={() => navigate('/evaluations')}
            className="flex-col h-auto py-2 relative"
            aria-label="Avaliar"
          >
            <span className={`relative inline-flex items-center justify-center rounded-md h-[72px] w-[72px] sm:h-[84px] sm:w-[84px] md:h-[96px] md:w-[96px] ${isActive('/evaluations') ? 'ring-2 ring-cyan-300/50 shadow-[0_0_10px_rgba(0,255,255,0.08)] scale-105' : 'ring-1 ring-transparent/0'} transition-transform duration-150 hover:scale-105 active:scale-110`}>
              <img src={iconAvaliar} alt="Avaliar" className="max-h-full max-w-full object-contain" />
              <span
                className={`absolute -top-1 -right-1 text-white text-[10px] leading-none rounded-full px-1.5 py-0.5 ${evalBadge >= 1 ? 'bg-red-600' : 'bg-green-600'}`}
              >
                {evalBadge > 99 ? '99+' : evalBadge}
              </span>
            </span>
          </Button>
        )}
        
        {studioAccess && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive('/studio') ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => navigate('/studio')}
                  className={cn("flex-col h-auto py-2 relative")}
                  aria-label="Studio"
                >
                  <div className="relative flex items-center justify-center">
                  <span className={`relative inline-flex items-center justify-center rounded-md h-[72px] w-[72px] sm:h-[84px] sm:w-[84px] md:h-[96px] md:w-[96px] ${isActive('/studio') ? 'ring-2 ring-cyan-300/50 shadow-[0_0_10px_rgba(0,255,255,0.08)] scale-105' : 'ring-1 ring-transparent/0'} transition-transform duration-150 hover:scale-105 active:scale-110`}>
                    <img src={iconStudio} alt="Studio" className="max-h-full max-w-full object-contain" />
                    <span className={`absolute -top-1 -right-1 text-white text-[10px] leading-none rounded-full px-1.5 py-0.5 ${studioBadge >= 1 ? 'bg-red-600' : 'bg-green-600'}`}>
                      {studioBadge > 99 ? '99+' : studioBadge}
                    </span>
                  </span>
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Studio</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        
        <Button
          variant={isActive('/profile') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/profile')}
          className="flex-col h-auto py-2"
          aria-label="Perfil"
        >
          <span className={`inline-flex items-center justify-center rounded-md h-[72px] w-[72px] sm:h-[84px] sm:w-[84px] md:h-[96px] md:w-[96px] ${isActive('/profile') ? 'ring-2 ring-cyan-300/50 shadow-[0_0_10px_rgba(0,255,255,0.08)] scale-105' : 'ring-1 ring-transparent/0'} transition-transform duration-150 hover:scale-105 active:scale-110`}>
            <img src={iconProfile} alt="Perfil" className="max-h-full max-w-full object-contain" />
          </span>
        </Button>

        <Button
          variant={'ghost'}
          size="sm"
          onClick={async () => {
            try {
              // limpar possíveis caches extras
              try { localStorage.clear(); } catch {}
              await signOut();
            } finally {
              window.location.href = '/';
            }
          }}
          className="flex-col h-auto py-2"
          aria-label="Sair"
        >
          <span className="inline-flex items-center justify-center rounded-md h-[72px] w-[72px] sm:h-[84px] sm:w-[84px] md:h-[96px] md:w-[96px] ring-1 ring-transparent transition-transform duration-150 hover:scale-105 active:scale-110">
            <img src={iconLogout} alt="Sair" className="max-h-full max-w-full object-contain" />
          </span>
        </Button>
      </div>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar Senha</DialogTitle>
          </DialogHeader>
          <ChangePasswordCard compact />
        </DialogContent>
      </Dialog>
    </nav>
  );
};

export default Navigation;
