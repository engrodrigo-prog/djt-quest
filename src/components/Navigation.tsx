import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
//
import iconHome from '@/assets/backgrounds/home.png';
import iconRanking from '@/assets/backgrounds/Ranking.png';
import iconAvaliar from '@/assets/backgrounds/avaliar.png';
import iconForum from '@/assets/backgrounds/Forum.png';
import iconStudio from '@/assets/backgrounds/studio.png';
import iconProfile from '@/assets/backgrounds/perfil.png';
import iconLogout from '@/assets/backgrounds/SAIR.png';
import iconSEPBook from '@/assets/backgrounds/SEPbook.png';
import iconStudy from '@/assets/backgrounds/studylab.png';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';
import bgMenu from '@/assets/backgrounds/BG Menu.png';

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { studioAccess, isLeader, signOut } = useAuth();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [studioBadge, setStudioBadge] = useState(0);
  const [evalBadge, setEvalBadge] = useState(0);
  const [forumBadge, setForumBadge] = useState(0);
  const [sepbookNew, setSepbookNew] = useState(0);
  const [sepbookMentions, setSepbookMentions] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [itemSize, setItemSize] = useState<number>(60);

  // Calculate dynamic item size so all buttons fit without gaps/scroll on current viewport
  const visibleCount = useMemo(() => {
    // Home, Forums, SEPBook, Study, Profile, Rankings, Logout
    // Optional: Evaluations (leader), Studio (studioAccess)
    let count = 7;
    if (isLeader) count += 1;
    if (studioAccess) count += 1;
    return count;
  }, [isLeader, studioAccess]);

  useEffect(() => {
    const calc = () => {
      const el = barRef.current;
      if (!el) return;
      const width = el.clientWidth; // available width for items
      // Reserve minimal side padding (8px total) and no gaps between items
      const available = Math.max(0, width - 8);
      // Compute size per item, clamp to sensible range
      const raw = Math.floor(available / Math.max(1, visibleCount));
      const clamped = Math.max(48, Math.min(84, raw));
      setItemSize(clamped);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [visibleCount]);

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
        const resp = await apiFetch('/api/admin?handler=studio-pending-counts');
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || 'Falha nas contagens');

        const approvals = json?.approvals || 0;
        const passwordResets = json?.passwordResets || 0;
        const registrations = json?.registrations || 0;
        const evaluations = json?.evaluations || 0;
        const leadershipAssignments = json?.leadershipAssignments || 0;
        const forumMentions = json?.forumMentions || 0;
        const evalTotal = evaluations + leadershipAssignments;

        if (!active) return;
        setStudioBadge(studioAccess ? approvals + passwordResets + registrations + evaluations : 0);
        setEvalBadge(isLeader ? evalTotal : 0);
        setForumBadge(forumMentions);

        // SEPBook summary continua vindo da API dedicada
        try {
          const resp2 = await apiFetch('/api/sepbook-summary');
          const json2 = await resp2.json();
          if (resp2.ok && active) {
            setSepbookNew(json2.new_posts || 0);
            setSepbookMentions(json2.mentions || 0);
          }
        } catch {
          if (active) {
            setSepbookNew(0);
            setSepbookMentions(0);
          }
        }
      } catch {
        if (!active) return;
        setStudioBadge(0);
        setEvalBadge(0);
        setForumBadge(0);
        setSepbookNew(0);
        setSepbookMentions(0);
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
  }, [studioAccess, isLeader]);

  // Ouvir eventos globais de leitura de menções para limpar badges imediatamente
  useEffect(() => {
    const onForumSeen = () => setForumBadge(0);
    const onSepbookSeen = () => { setSepbookNew(0); setSepbookMentions(0); };
    window.addEventListener('forum-mentions-seen', onForumSeen as any);
    window.addEventListener('sepbook-summary-updated', onSepbookSeen as any);
    return () => {
      window.removeEventListener('forum-mentions-seen', onForumSeen as any);
      window.removeEventListener('sepbook-summary-updated', onSepbookSeen as any);
    };
  }, []);

  const isActive = (path: string) => location.pathname === path;
  const baseButtonClass =
    "flex-col h-auto py-1 gap-1 snap-center rounded-none first:rounded-l-xl last:rounded-r-xl hover:bg-white/5";
  const bubbleClass = (active: boolean) =>
    cn(
      "relative inline-flex items-center justify-center rounded-2xl border border-white/10 bg-slate-800/80 backdrop-blur-md shadow-[0_8px_20px_rgba(0,0,0,0.45)] transition-transform duration-150 hover:scale-105 active:scale-110",
      active ? "ring-2 ring-cyan-300/60 shadow-[0_0_18px_rgba(0,255,255,0.28)] scale-105" : "ring-0"
    );
  const labelClass = (active: boolean) =>
    cn("text-[11px] font-semibold leading-4 tracking-tight", active ? "text-slate-50" : "text-slate-200/80");
  const badgeClass = (alert?: boolean) =>
    cn(
      "absolute -top-1 -right-1 text-white text-[11px] leading-none rounded-full px-1.5 py-0.5 min-w-[20px] text-center shadow-sm",
      alert ? "bg-destructive" : "bg-emerald-600"
    );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 min-h-[96px] bg-transparent overflow-visible"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      {/* Decorative background for the bottom bar (BG Menu.png), does not block clicks */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `url(${bgMenu})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          filter: 'brightness(0.85) saturate(1.1)'
        }} />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/70 to-transparent" />
      </div>
      <div ref={barRef} className="relative mx-auto max-w-[1200px] px-2 md:px-4 flex items-center justify-center gap-0 py-0 overflow-x-auto overflow-y-visible min-h-[96px] touch-pan-x">
        <div className="nav-rail relative flex items-center justify-center gap-0 bg-slate-950/80 border border-white/10 rounded-2xl px-2 py-2 shadow-2xl backdrop-blur-xl min-w-max">
        <Button
          variant={isActive('/dashboard') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/dashboard')}
          className={baseButtonClass}
          aria-label="Início"
          aria-current={isActive('/dashboard') ? 'page' : undefined}
        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/dashboard'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconHome} alt="Início" className="w-full h-full object-cover" />
            </span>
          </span>
          <span className={labelClass(isActive('/dashboard'))}>Início</span>
        </Button>
        
        <Button
          variant={location.pathname.startsWith('/forum') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/forums')}
          className={cn(baseButtonClass, 'relative')}
          aria-label="Fóruns"
          aria-current={location.pathname.startsWith('/forum') ? 'page' : undefined}
        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(location.pathname.startsWith('/forum'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconForum} alt="Fóruns" className="w-full h-full object-cover" />
            </span>
            {forumBadge > 0 && (
              <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                {forumBadge > 99 ? '99+' : forumBadge}
              </span>
            )}
          </span>
          <span className={labelClass(location.pathname.startsWith('/forum'))}>Fóruns</span>
        </Button>

        <Button
          variant={location.pathname.startsWith('/sepbook') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/sepbook')}
          className={cn(baseButtonClass, 'relative')}
          aria-label="SEPBook"
          aria-current={location.pathname.startsWith('/sepbook') ? 'page' : undefined}
        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(location.pathname.startsWith('/sepbook'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconSEPBook} alt="SEPBook" className="w-full h-full object-cover" />
            </span>
            {sepbookNew > 0 && (
              <span className={badgeClass(false)} style={{ zIndex: 5 }}>
                {sepbookNew > 99 ? '99+' : sepbookNew}
              </span>
            )}
          </span>
          <div className="flex flex-col items-center leading-tight">
            <span className={labelClass(location.pathname.startsWith('/sepbook'))}>SEPBook</span>
            {sepbookMentions > 0 && (
              <span className="text-[10px] text-emerald-300 font-semibold leading-tight -mt-0.5">
                {sepbookMentions}@
              </span>
            )}
          </div>
        </Button>

        <Button
          variant={isActive('/study') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/study')}
          className={baseButtonClass}
          aria-label="Estudos"
          aria-current={isActive('/study') ? 'page' : undefined}
        >
          <span
            style={{ width: itemSize, height: itemSize }}
            className={bubbleClass(isActive('/study'))}
          >
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconStudy} alt="Estudos" className="w-full h-full object-cover" />
            </span>
          </span>
          <span className={labelClass(isActive('/study'))}>Estudos</span>
        </Button>
        
        {isLeader && (
          <Button
            variant={isActive('/evaluations') ? 'default' : 'ghost'}
            size="sm"
            onClick={() => navigate('/evaluations')}
            className={cn(baseButtonClass, 'relative')}
            aria-label="Avaliar"
            aria-current={isActive('/evaluations') ? 'page' : undefined}
          >
            <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/evaluations'))}>
              <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
                <img src={iconAvaliar} alt="Avaliar" className="w-full h-full object-cover" />
              </span>
              {evalBadge > 0 && (
                <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                  {evalBadge > 99 ? '99+' : evalBadge}
                </span>
              )}
            </span>
            <span className={labelClass(isActive('/evaluations'))}>Avaliar</span>
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
                  className={cn(baseButtonClass, "relative")}
                  aria-label="Studio"
                  aria-current={isActive('/studio') ? 'page' : undefined}
                >
                  <div className="relative flex items-center justify-center">
                  <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/studio'))}>
                    <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
                      <img src={iconStudio} alt="Studio" className="w-full h-full object-cover" />
                    </span>
                    {studioBadge > 0 && (
                      <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                        {studioBadge > 99 ? '99+' : studioBadge}
                      </span>
                    )}
                  </span>
                  </div>
                  <span className={labelClass(isActive('/studio'))}>Studio</span>
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
          className={baseButtonClass}
          aria-label="Perfil"
          aria-current={isActive('/profile') ? 'page' : undefined}
        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/profile'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconProfile} alt="Perfil" className="w-full h-full object-cover" />
            </span>
          </span>
          <span className={labelClass(isActive('/profile'))}>Perfil</span>
        </Button>

        <Button
          variant={isActive('/rankings') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/rankings')}
          className={baseButtonClass}
          aria-label="Rankings"
          aria-current={isActive('/rankings') ? 'page' : undefined}
        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/rankings'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconRanking} alt="Rankings" className="w-full h-full object-cover" />
            </span>
          </span>
          <span className={labelClass(isActive('/rankings'))}>Rankings</span>
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
          className={baseButtonClass}
          aria-label="Sair"
        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(false)}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconLogout} alt="Sair" className="w-full h-full object-cover" />
            </span>
          </span>
          <span className={labelClass(false)}>Sair</span>
        </Button>
        </div>
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
