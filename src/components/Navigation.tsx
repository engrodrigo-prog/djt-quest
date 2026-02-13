import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
//
import iconHome from '@/assets/backgrounds/home.webp';
import iconRanking from '@/assets/backgrounds/Ranking.webp';
import iconAvaliar from '@/assets/backgrounds/avaliar.webp';
import iconForum from '@/assets/backgrounds/Forum.webp';
import iconStudio from '@/assets/backgrounds/studio.webp';
import iconProfile from '@/assets/backgrounds/perfil.webp';
import iconLogout from '@/assets/backgrounds/SAIR.webp';
import iconSEPBook from '@/assets/backgrounds/SEPbook.webp';
import iconStudy from '@/assets/backgrounds/studylab.webp';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';
import bgMenu from '@/assets/backgrounds/BG Menu.webp';
import { useI18n } from '@/contexts/I18nContext';
import { useSfx } from '@/lib/sfx';
import { Menu, X } from 'lucide-react';

const Navigation = () => {
  const location = useLocation();
  const { user, studioAccess, isLeader, signOut } = useAuth();
  const { t } = useI18n();
  const { play: playSfx } = useSfx();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [studioBadge, setStudioBadge] = useState(0);
  const [evalBadge, setEvalBadge] = useState(0);
  const [forumBadge, setForumBadge] = useState(0);
  const [notifBadge, setNotifBadge] = useState(0);
  const [homeBadge, setHomeBadge] = useState(0);
  const [studyBadge, setStudyBadge] = useState(0);
  const [sepbookNew, setSepbookNew] = useState(0);
  const [sepbookMentions, setSepbookMentions] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const originalBodyPaddingLeftRef = useRef<string | null>(null);
  const [itemSize, setItemSize] = useState<number>(60);
  const playSfxRef = useRef(playSfx);
  const notifTotalRef = useRef<number | null>(null);
  const [navHidden, setNavHidden] = useState(false);
  const [navExpanded, setNavExpanded] = useState(false);
  const showEvaluations = Boolean(isLeader || evalBadge > 0);
  const badgeFetchInFlightRef = useRef(false);
  const badgeFetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    playSfxRef.current = playSfx;
  }, [playSfx]);

  const hardNavigate = useCallback(async (path: string) => {
    if (typeof window === 'undefined') return;
    const nextPath = String(path || '').trim();
    if (!nextPath.startsWith('/')) return;
    if (window.location.pathname === nextPath) return;

    // Best-effort: clear CacheStorage (e.g. if a SW ever cached assets).
    // Do NOT clear localStorage here (it would log users out / reset preferences).
    try {
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      }
    } catch {
      // ignore
    }

    // Force a full navigation (not SPA) + cache-bust the HTML request.
    try {
      const url = new URL(nextPath, window.location.origin);
      url.searchParams.set('__djt', String(Date.now()));
      window.location.href = url.toString();
    } catch {
      window.location.href = nextPath;
    }
  }, []);

  // Calculate dynamic item size so all buttons fit without gaps/scroll on current viewport
  const visibleCount = useMemo(() => {
    // Home, Forums, SEPBook, Study, Profile, Rankings, Logout
    // Optional: Evaluations (leader), Studio (studioAccess)
    let count = 7;
    // When focus mode expands the nav, we render a close button inside the rail.
    if (navHidden) count += 1;
    if (showEvaluations) count += 1;
    if (studioAccess) count += 1;
    return count;
  }, [navHidden, showEvaluations, studioAccess]);

  useEffect(() => {
    let raf = 0;
    const calc = () => {
      raf = 0;
      const el = barRef.current;
      if (!el) return;
      const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

      if (isDesktop) {
        const height = el.clientHeight; // available height for items
        // Desktop rail: ensure everything fits vertically without scrollbars.
        const railPadding = 64; // container + rail padding + breathing room
        const railGap = 2; // md:gap-0.5
        const labelHeight = 12; // md:leading-3
        const buttonPaddingY = 4; // md:py-0.5
        const internalGap = 2; // md:gap-0.5
        const overheadPerItem = labelHeight + buttonPaddingY + internalGap;
        const available =
          Math.max(0, height - railPadding - railGap * Math.max(0, visibleCount - 1));
        const raw = Math.floor(available / Math.max(1, visibleCount) - overheadPerItem);
        const clamped = Math.max(20, Math.min(80, raw));
        setItemSize((prev) => (prev === clamped ? prev : clamped));
        return;
      }

      const width = el.clientWidth; // available width for items
      // Reserve minimal side padding (8px total) and no gaps between items
      const available = Math.max(0, width - 8);
      // Compute size per item, clamp to sensible range
      const raw = Math.floor(available / Math.max(1, visibleCount));
      const clamped = Math.max(48, Math.min(84, raw));
      setItemSize((prev) => (prev === clamped ? prev : clamped));
    };
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(calc);
    };

    schedule();

    const el = barRef.current;
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && el) {
      ro = new ResizeObserver(() => schedule());
      try {
        ro.observe(el);
      } catch {
        // ignore
      }
    } else {
      window.addEventListener('resize', schedule);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [visibleCount]);

  useEffect(() => {
    const handler = () => setPasswordDialogOpen(true);
    window.addEventListener('open-password-dialog', handler as any);
    return () => window.removeEventListener('open-password-dialog', handler as any);
  }, []);

  // Allow pages to request a "focus mode" that collapses the bottom navigation.
  useEffect(() => {
    const onToggle = (ev: any) => {
      const hidden = Boolean(ev?.detail?.hidden);
      setNavHidden(hidden);
      if (hidden) setNavExpanded(false);
    };
    window.addEventListener('djt-nav-visibility', onToggle as any);
    return () => window.removeEventListener('djt-nav-visibility', onToggle as any);
  }, []);

  // Desktop: move nav to the left, so reserve horizontal space (widescreen-friendly).
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (originalBodyPaddingLeftRef.current == null) {
      originalBodyPaddingLeftRef.current = document.body.style.paddingLeft || '';
    }
    const original = originalBodyPaddingLeftRef.current || '';
    const mq = window.matchMedia('(min-width: 768px)');
    const offset = '120px';

    const apply = () => {
      const shouldOffset = mq.matches && !(navHidden && !navExpanded);
      document.body.style.paddingLeft = shouldOffset ? offset : original;
    };

    apply();
    const onChange = () => apply();

    try {
      mq.addEventListener('change', onChange);
      return () => {
        mq.removeEventListener('change', onChange);
        document.body.style.paddingLeft = original;
      };
    } catch {
      (mq as any).addListener?.(onChange);
      return () => {
        (mq as any).removeListener?.(onChange);
        document.body.style.paddingLeft = original;
      };
    }
  }, [navExpanded, navHidden]);

  useEffect(() => {
    let active = true;
    let timer: any;

	    const fetchCounts = async () => {
        if (!active) return;
        if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
        if (badgeFetchInFlightRef.current) return;
        badgeFetchInFlightRef.current = true;
        // Abort any previous in-flight request to avoid piling up on slow networks.
        try {
          badgeFetchAbortRef.current?.abort();
        } catch {
          // ignore
        }
        const thisController = new AbortController();
        badgeFetchAbortRef.current = thisController;

        const fetchWithTimeout = async (url: string, timeoutMs: number) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          const onAbort = () => controller.abort();
          try {
            thisController.signal.addEventListener('abort', onAbort);
            const resp = await apiFetch(url, { signal: controller.signal });
            const json = await resp.json().catch(() => ({}));
            return { resp, json };
          } finally {
            clearTimeout(timeout);
            try {
              thisController.signal.removeEventListener('abort', onAbort);
            } catch {
              // ignore
            }
          }
        };

	      try {
          const [adminRes, sepRes] = await Promise.allSettled([
            fetchWithTimeout('/api/admin?handler=studio-pending-counts', 9000),
            fetchWithTimeout('/api/sepbook-summary', 9000),
          ]);

          const adminPayload =
            adminRes.status === 'fulfilled' && adminRes.value?.resp?.ok ? adminRes.value.json : null;
          const sepPayload =
            sepRes.status === 'fulfilled' && sepRes.value?.resp?.ok ? sepRes.value.json : null;
	        if (!adminPayload) throw new Error('Falha nas contagens');

        const approvals = adminPayload?.approvals || 0;
        const passwordResets = adminPayload?.passwordResets || 0;
        const registrations = adminPayload?.registrations || 0;
        const evaluations = adminPayload?.evaluations || 0;
        const leadershipAssignments = adminPayload?.leadershipAssignments || 0;
        const forumMentions = adminPayload?.forumMentions || 0;
        const notifications = adminPayload?.notifications || 0;
        const campaigns = adminPayload?.campaigns || 0;
        const challengesActive = adminPayload?.challengesActive || 0;
        const quizzesPending = adminPayload?.quizzesPending || 0;
        const nextHomeBadge = Math.max(0, Number(campaigns) + Number(challengesActive));
        const nextStudyBadge = Math.max(0, Number(quizzesPending));
          let evalCount = Number(evaluations) || 0;
          try {
            if (user?.id) {
              const result = await Promise.race([
                supabase
                  .from('evaluation_queue')
                  .select('id', { count: 'exact', head: true })
                  .eq('assigned_to', user.id)
                  .is('completed_at', null),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
              ]);
              const { count, error } = result as any;
              if (!error) evalCount = count || 0;
            }
          } catch {
            // ignore; fallback to server count
          }
	        const evalTotal = evalCount + leadershipAssignments;
          const sepNew = sepPayload?.new_posts || 0;
          const sepMentions = sepPayload?.mentions || 0;

	        if (!active) return;
		        setStudioBadge(studioAccess ? approvals + passwordResets + registrations : 0);
		        setEvalBadge(evalTotal);
		        setForumBadge(forumMentions);
          setNotifBadge(notifications);
          setHomeBadge(nextHomeBadge);
          setStudyBadge(nextStudyBadge);
		        setSepbookNew(sepNew);
		        setSepbookMentions(sepMentions);

          const nextTotal =
            (studioAccess ? approvals + passwordResets + registrations : 0) +
            evalTotal +
            forumMentions +
            notifications +
            nextHomeBadge +
            nextStudyBadge +
            sepNew +
            sepMentions;
          const prevTotal = notifTotalRef.current;
          notifTotalRef.current = nextTotal;
          if (prevTotal != null && nextTotal > prevTotal) {
            playSfxRef.current("notification");
          }
      } catch {
        if (!active) return;
        let evalCount = 0;
        try {
          if (user?.id) {
            const result = await Promise.race([
              supabase
                .from('evaluation_queue')
                .select('id', { count: 'exact', head: true })
                .eq('assigned_to', user.id)
                .is('completed_at', null),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
            ]);
            const { count, error } = result as any;
            if (!error) evalCount = count || 0;
          }
        } catch {
          evalCount = 0;
        }
        setStudioBadge(0);
        setEvalBadge(evalCount);
	        setForumBadge(0);
	        setNotifBadge(0);
	        setHomeBadge(0);
          setStudyBadge(0);
	        setSepbookNew(0);
	        setSepbookMentions(0);
	      }
        finally {
          if (badgeFetchAbortRef.current === thisController) {
            badgeFetchAbortRef.current = null;
          }
          badgeFetchInFlightRef.current = false;
        }
	    };

    const stopPolling = () => {
      clearInterval(timer);
      timer = null;
    };

    const startPolling = () => {
      stopPolling();
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      timer = setInterval(fetchCounts, 45000); // 45s (reduce noise on mobile)
    };

    fetchCounts();
    startPolling();

    const onFocus = () => {
      fetchCounts();
      startPolling();
    };
    const onOnline = () => {
      fetchCounts();
      startPolling();
    };
    const onOffline = () => stopPolling();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchCounts();
        startPolling();
      } else {
        stopPolling();
      }
    };
    const onManualRefresh = () => {
      fetchCounts();
      startPolling();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('djt-refresh-badges', onManualRefresh as any);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      stopPolling();
      try {
        badgeFetchAbortRef.current?.abort();
      } catch {
        // ignore
      }
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('djt-refresh-badges', onManualRefresh as any);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [studioAccess, user?.id]);

  // Ouvir eventos globais de leitura de menções para limpar badges imediatamente
  useEffect(() => {
    const onForumSeen = () => setForumBadge(0);
    const onSepbookLegacy = () => { setSepbookNew(0); setSepbookMentions(0); };
    const onSepbookLastSeen = () => setSepbookNew(0);
    const onSepbookMentionsSeen = () => setSepbookMentions(0);
    window.addEventListener('forum-mentions-seen', onForumSeen as any);
    window.addEventListener('sepbook-summary-updated', onSepbookLegacy as any);
    window.addEventListener('sepbook-last-seen-updated', onSepbookLastSeen as any);
    window.addEventListener('sepbook-mentions-seen', onSepbookMentionsSeen as any);
    return () => {
      window.removeEventListener('forum-mentions-seen', onForumSeen as any);
      window.removeEventListener('sepbook-summary-updated', onSepbookLegacy as any);
      window.removeEventListener('sepbook-last-seen-updated', onSepbookLastSeen as any);
      window.removeEventListener('sepbook-mentions-seen', onSepbookMentionsSeen as any);
    };
  }, []);

  const isActive = (path: string) => location.pathname === path;
  const baseButtonClass =
    "flex-col h-auto py-1 gap-1 snap-center rounded-none first:rounded-l-xl last:rounded-r-xl hover:bg-white/5 md:w-full md:rounded-xl md:py-0.5 md:gap-0.5";
  const bubbleClass = (active: boolean) =>
    cn(
      "relative inline-flex items-center justify-center rounded-2xl border border-white/10 bg-slate-800/80 backdrop-blur-md shadow-[0_8px_20px_rgba(0,0,0,0.45)] transition-transform duration-150 hover:scale-105 active:scale-110",
      active ? "ring-2 ring-cyan-300/60 shadow-[0_0_18px_rgba(0,255,255,0.28)] scale-105" : "ring-0"
    );
  const labelClass = (active: boolean) =>
    cn(
      "text-[11px] font-semibold leading-4 tracking-tight max-w-[92px] truncate md:leading-3",
      active ? "text-slate-50" : "text-slate-200/80"
    );
  const badgeClass = (alert?: boolean) =>
    cn(
      "absolute -top-1 -right-1 text-white text-[11px] leading-none rounded-full px-1.5 py-0.5 min-w-[20px] text-center shadow-sm",
      alert ? "bg-destructive" : "bg-emerald-600"
    );

  if (navHidden && !navExpanded) {
    const totalBadge = studioBadge + evalBadge + forumBadge + notifBadge + homeBadge + studyBadge + sepbookNew + sepbookMentions;
    return (
      <div
        className="fixed bottom-0 right-0 z-30 p-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        <button
          type="button"
          onClick={() => setNavExpanded(true)}
          className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/80 text-white shadow-[0_10px_24px_rgba(0,0,0,0.55)] backdrop-blur-md hover:bg-slate-900"
          aria-label="Abrir menu"
          title="Abrir menu"
        >
          <Menu className="h-6 w-6" />
          {totalBadge > 0 && (
            <span className={badgeClass(true)} style={{ zIndex: 5 }}>
              {totalBadge > 99 ? '99+' : totalBadge}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 min-h-[96px] bg-transparent overflow-visible md:top-0 md:bottom-0 md:left-0 md:right-auto md:min-h-0 md:w-[120px]"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      {/* Decorative background (mobile bottom bar vs desktop left rail), does not block clicks */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0 md:hidden"
          style={{
            backgroundImage: `url(${bgMenu})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'brightness(0.85) saturate(1.1)',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/70 to-transparent md:hidden" />
        <div className="absolute inset-0 hidden md:block bg-gradient-to-b from-slate-950/85 via-slate-950/70 to-slate-950/90" />
      </div>
      <div
        ref={barRef}
        className="relative mx-auto max-w-[1200px] px-2 flex items-center justify-center gap-0 py-0 overflow-x-auto overflow-y-visible min-h-[96px] touch-pan-x md:mx-0 md:max-w-none md:h-full md:px-2 md:py-3 md:items-start md:justify-start md:overflow-hidden md:overflow-x-hidden"
      >
        <div className="nav-rail relative flex items-center justify-center gap-0 bg-slate-950/80 border border-white/10 rounded-2xl px-2 py-2 shadow-2xl backdrop-blur-xl min-w-max md:flex-col md:w-full md:min-w-0 md:gap-0.5 md:px-1 md:py-1">
	        {navHidden && (
	          <Button
	            type="button"
	            size="icon"
	            variant="ghost"
	            className="h-9 w-9 mr-1 md:mr-0 md:mb-0.5 md:h-8 md:w-8"
	            onClick={() => {
	              setNavExpanded(false);
	              setNavHidden(true);
	            }}
            aria-label="Fechar menu"
            title="Fechar menu"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
	        <Button
	          variant={isActive('/dashboard') ? 'default' : 'ghost'}
	          size="sm"
	          onClick={() => void hardNavigate('/dashboard')}
	          className={baseButtonClass}
	          aria-label={t("nav.dashboard")}
	          aria-current={isActive('/dashboard') ? 'page' : undefined}
	        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/dashboard'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconHome} alt={t("nav.dashboard")} className="w-full h-full object-cover" />
            </span>
            {homeBadge > 0 && (
              <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                {homeBadge > 99 ? '99+' : homeBadge}
              </span>
            )}
          </span>
          <span className={labelClass(isActive('/dashboard'))} title={t("nav.dashboard")}>{t("nav.dashboard")}</span>
        </Button>
        
	        <Button
	          variant={location.pathname.startsWith('/forum') ? 'default' : 'ghost'}
	          size="sm"
	          onClick={() => void hardNavigate('/forums')}
	          className={cn(baseButtonClass, 'relative')}
	          aria-label={t("nav.forums")}
	          aria-current={location.pathname.startsWith('/forum') ? 'page' : undefined}
	        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(location.pathname.startsWith('/forum'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconForum} alt={t("nav.forums")} className="w-full h-full object-cover" />
            </span>
            {forumBadge > 0 && (
              <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                {forumBadge > 99 ? '99+' : forumBadge}
              </span>
            )}
          </span>
          <span className={labelClass(location.pathname.startsWith('/forum'))} title={t("nav.forums")}>{t("nav.forums")}</span>
        </Button>

	        <Button
	          variant={location.pathname.startsWith('/sepbook') ? 'default' : 'ghost'}
	          size="sm"
	          onClick={() => void hardNavigate('/sepbook')}
	          className={cn(baseButtonClass, 'relative')}
	          aria-label={t("nav.sepbook")}
	          aria-current={location.pathname.startsWith('/sepbook') ? 'page' : undefined}
	        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(location.pathname.startsWith('/sepbook'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconSEPBook} alt={t("nav.sepbook")} className="w-full h-full object-cover" />
            </span>
            {(sepbookNew > 0 || sepbookMentions > 0) && (
              <span className={badgeClass(sepbookMentions > 0)} style={{ zIndex: 5 }}>
                {(sepbookNew + sepbookMentions) > 99 ? '99+' : (sepbookNew + sepbookMentions)}
              </span>
            )}
          </span>
          <div className="flex flex-col items-center leading-tight">
            <span className={labelClass(location.pathname.startsWith('/sepbook'))} title={t("nav.sepbook")}>{t("nav.sepbook")}</span>
	            {sepbookMentions > 0 && (
	              <span className="text-[10px] text-emerald-300 font-semibold leading-tight -mt-0.5 md:hidden">
	                {sepbookMentions}@
	              </span>
	            )}
	          </div>
	        </Button>

	        <Button
	          variant={isActive('/study') ? 'default' : 'ghost'}
	          size="sm"
	          onClick={() => void hardNavigate('/study')}
	          className={baseButtonClass}
	          aria-label={t("nav.study")}
	          aria-current={isActive('/study') ? 'page' : undefined}
	        >
          <span
            style={{ width: itemSize, height: itemSize }}
            className={bubbleClass(isActive('/study'))}
          >
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconStudy} alt={t("nav.study")} className="w-full h-full object-cover" />
            </span>
            {studyBadge > 0 && (
              <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                {studyBadge > 99 ? '99+' : studyBadge}
              </span>
            )}
          </span>
          <span className={labelClass(isActive('/study'))} title={t("nav.study")}>{t("nav.study")}</span>
        </Button>
        
		        {showEvaluations && (
		          <Button
		            variant={isActive('/evaluations') ? 'default' : 'ghost'}
		            size="sm"
		            onClick={() => void hardNavigate('/evaluations')}
		            className={cn(baseButtonClass, 'relative')}
	            aria-label={t("nav.evaluations")}
	            aria-current={isActive('/evaluations') ? 'page' : undefined}
	          >
            <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/evaluations'))}>
              <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
                <img src={iconAvaliar} alt={t("nav.evaluations")} className="w-full h-full object-cover" />
              </span>
              {evalBadge > 0 && (
                <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                  {evalBadge > 99 ? '99+' : evalBadge}
                </span>
              )}
            </span>
            <span className={labelClass(isActive('/evaluations'))} title={t("nav.evaluations")}>{t("nav.evaluations")}</span>
          </Button>
        )}
        
        {studioAccess && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
	                <Button
	                  variant={isActive('/studio') ? 'default' : 'ghost'}
	                  size="sm"
	                  onClick={() => void hardNavigate('/studio')}
	                  className={cn(baseButtonClass, "relative")}
	                  aria-label={t("nav.studio")}
	                  aria-current={isActive('/studio') ? 'page' : undefined}
	                >
                  <div className="relative flex items-center justify-center">
                  <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/studio'))}>
                    <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
                      <img src={iconStudio} alt={t("nav.studio")} className="w-full h-full object-cover" />
                    </span>
                    {studioBadge > 0 && (
                      <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                        {studioBadge > 99 ? '99+' : studioBadge}
                      </span>
                    )}
                  </span>
                  </div>
                  <span className={labelClass(isActive('/studio'))} title={t("nav.studio")}>{t("nav.studio")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("nav.studio")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        
	        <Button
	          variant={isActive('/profile') ? 'default' : 'ghost'}
	          size="sm"
	          onClick={() => void hardNavigate('/profile')}
	          className={baseButtonClass}
	          aria-label={t("nav.profile")}
	          aria-current={isActive('/profile') ? 'page' : undefined}
	        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/profile'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconProfile} alt={t("nav.profile")} className="w-full h-full object-cover" />
            </span>
            {notifBadge > 0 && (
              <span className={badgeClass(true)} style={{ zIndex: 5 }}>
                {notifBadge > 99 ? '99+' : notifBadge}
              </span>
            )}
          </span>
          <span className={labelClass(isActive('/profile'))} title={t("nav.profile")}>{t("nav.profile")}</span>
        </Button>

	        <Button
	          variant={isActive('/rankings') ? 'default' : 'ghost'}
	          size="sm"
	          onClick={() => void hardNavigate('/rankings')}
	          className={baseButtonClass}
	          aria-label={t("nav.rankings")}
	          aria-current={isActive('/rankings') ? 'page' : undefined}
	        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(isActive('/rankings'))}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconRanking} alt={t("nav.rankings")} className="w-full h-full object-cover" />
            </span>
          </span>
          <span className={labelClass(isActive('/rankings'))} title={t("nav.rankings")}>{t("nav.rankings")}</span>
        </Button>

        <Button
          variant={'ghost'}
          size="sm"
	          onClick={async () => {
	            try {
	              // limpar possíveis caches extras
	              try { localStorage.clear(); } catch { /* ignore */ }
	              await signOut();
	            } finally {
	              window.location.href = '/';
	            }
	          }}
          className={baseButtonClass}
          aria-label={t("nav.logout")}
        >
          <span style={{ width: itemSize, height: itemSize }} className={bubbleClass(false)}>
            <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
              <img src={iconLogout} alt={t("nav.logout")} className="w-full h-full object-cover" />
            </span>
          </span>
          <span className={labelClass(false)} title={t("nav.logout")}>{t("nav.logout")}</span>
        </Button>
        </div>
      </div>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("profile.changePasswordTitle")}</DialogTitle>
            <DialogDescription className="sr-only">Alterar senha</DialogDescription>
          </DialogHeader>
          <ChangePasswordCard compact />
        </DialogContent>
      </Dialog>
    </nav>
  );
};

export default Navigation;
