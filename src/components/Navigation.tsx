import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import iconHome from '@/assets/backgrounds/home.webp';
import iconRanking from '@/assets/backgrounds/Ranking.webp';
import iconAvaliar from '@/assets/backgrounds/avaliar.webp';
import iconForum from '@/assets/backgrounds/Forum.webp';
import iconStudio from '@/assets/backgrounds/studio.webp';
import iconProfile from '@/assets/backgrounds/perfil.webp';
import iconLogout from '@/assets/backgrounds/SAIR.webp';
import iconSEPBook from '@/assets/backgrounds/SEPbook.webp';
import iconStudy from '@/assets/backgrounds/studylab.webp';
import bgMenu from '@/assets/backgrounds/BG Menu.webp';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { supabase } from '@/integrations/supabase/client';
import { apiFetch } from '@/lib/api';
import { useSfx } from '@/lib/sfx';
import { cn } from '@/lib/utils';
import { Menu, X } from 'lucide-react';

type NavEntry = {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  badge?: number;
  alertBadge?: boolean;
  onSelect: () => void;
};

const Navigation = () => {
  const navigate = useNavigate();
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
  const [navHidden, setNavHidden] = useState(false);
  const [navExpanded, setNavExpanded] = useState(false);
  const [desktopNavScale, setDesktopNavScale] = useState(1);

  const playSfxRef = useRef(playSfx);
  const notifTotalRef = useRef<number | null>(null);
  const badgeFetchInFlightRef = useRef(false);
  const badgeFetchAbortRef = useRef<AbortController | null>(null);

  const showEvaluations = Boolean(isLeader || evalBadge > 0);
  const desktopItemCount = 7 + (showEvaluations ? 1 : 0) + (studioAccess ? 1 : 0);

  useEffect(() => {
    playSfxRef.current = playSfx;
  }, [playSfx]);

  useEffect(() => {
    const handler = () => setPasswordDialogOpen(true);
    window.addEventListener('open-password-dialog', handler as any);
    return () => window.removeEventListener('open-password-dialog', handler as any);
  }, []);

  // Allow pages to request a focus mode where nav collapses to one button.
  useEffect(() => {
    const onToggle = (ev: any) => {
      const hidden = Boolean(ev?.detail?.hidden);
      setNavHidden(hidden);
      if (hidden) {
        setNavExpanded(false);
      }
    };
    window.addEventListener('djt-nav-visibility', onToggle as any);
    return () => window.removeEventListener('djt-nav-visibility', onToggle as any);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: any;

    const fetchCounts = async () => {
      if (!active) return;
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
      if (badgeFetchInFlightRef.current) return;
      badgeFetchInFlightRef.current = true;

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
          playSfxRef.current('notification');
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
      } finally {
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
      timer = setInterval(fetchCounts, 45000);
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

  // Clear badges immediately when dedicated events fire.
  useEffect(() => {
    const onForumSeen = () => setForumBadge(0);
    const onSepbookLegacy = () => {
      setSepbookNew(0);
      setSepbookMentions(0);
    };
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const recalcDesktopScale = () => {
      const totalRows = Math.max(1, desktopItemCount);
      const viewportHeight = Math.max(640, Number(window.innerHeight || 0));
      // Header + paddings + separator + safe margin.
      const fixedCost = 84;
      const rowBaseHeight = 58;
      const rawScale = (viewportHeight - fixedCost) / (totalRows * rowBaseHeight);
      const nextScale = Math.max(0.74, Math.min(1.12, Number.isFinite(rawScale) ? rawScale : 1));
      setDesktopNavScale((prev) => (Math.abs(prev - nextScale) > 0.01 ? nextScale : prev));
    };

    recalcDesktopScale();
    window.addEventListener('resize', recalcDesktopScale);
    return () => window.removeEventListener('resize', recalcDesktopScale);
  }, [desktopItemCount]);

  const isActive = (path: string) => location.pathname === path;
  const isForumActive = location.pathname.startsWith('/forum');
  const isSepbookActive = location.pathname.startsWith('/sepbook');
  const sepbookBadgeTotal = sepbookNew + sepbookMentions;
  const totalBadge =
    studioBadge + evalBadge + forumBadge + notifBadge + homeBadge + studyBadge + sepbookBadgeTotal;

  const badgeClass = (alert?: boolean) =>
    cn(
      'absolute -top-1.5 -right-1.5 text-white text-[11px] leading-none rounded-full px-1.5 py-0.5 min-w-[20px] text-center shadow-sm',
      alert ? 'bg-destructive' : 'bg-emerald-600',
    );

  const bubbleClass = (active: boolean, size: 'sm' | 'md' | 'lg' | 'xl' = 'md') =>
    cn(
      'relative inline-flex items-center justify-center rounded-2xl border border-white/10 bg-slate-800/85 backdrop-blur-md transition-transform duration-150',
      size === 'xl'
        ? 'h-[calc(46px*var(--djt-nav-scale,1))] w-[calc(46px*var(--djt-nav-scale,1))]'
        : size === 'lg'
          ? 'h-[52px] w-[52px]'
          : size === 'md'
            ? 'h-10 w-10'
            : 'h-9 w-9',
      active
        ? 'ring-2 ring-cyan-300/60 shadow-[0_0_18px_rgba(0,255,255,0.24)]'
        : 'ring-0 shadow-[0_8px_20px_rgba(0,0,0,0.35)]',
    );

  const goTo = (path: string) => {
    navigate(path);
  };

  const handleLogout = async () => {
    try {
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
      await signOut();
    } finally {
      window.location.href = '/';
    }
  };

  const mobileItems: NavEntry[] = [
    {
      key: 'dashboard',
      label: t('nav.dashboard'),
      icon: iconHome,
      active: isActive('/dashboard'),
      badge: homeBadge,
      alertBadge: true,
      onSelect: () => goTo('/dashboard'),
    },
    {
      key: 'forums',
      label: t('nav.forums'),
      icon: iconForum,
      active: isForumActive,
      badge: forumBadge,
      alertBadge: true,
      onSelect: () => goTo('/forums'),
    },
    {
      key: 'sepbook',
      label: t('nav.sepbook'),
      icon: iconSEPBook,
      active: isSepbookActive,
      badge: sepbookBadgeTotal,
      alertBadge: sepbookMentions > 0,
      onSelect: () => goTo('/sepbook'),
    },
    {
      key: 'study',
      label: t('nav.study'),
      icon: iconStudy,
      active: isActive('/study'),
      badge: studyBadge,
      alertBadge: true,
      onSelect: () => goTo('/study'),
    },
    ...(showEvaluations
      ? [
          {
            key: 'evaluations',
            label: t('nav.evaluations'),
            icon: iconAvaliar,
            active: isActive('/evaluations'),
            badge: evalBadge,
            alertBadge: true,
            onSelect: () => goTo('/evaluations'),
          } as NavEntry,
        ]
      : []),
    ...(studioAccess
      ? [
          {
            key: 'studio',
            label: t('nav.studio'),
            icon: iconStudio,
            active: isActive('/studio'),
            badge: studioBadge,
            alertBadge: true,
            onSelect: () => goTo('/studio'),
          } as NavEntry,
        ]
      : []),
    {
      key: 'profile',
      label: t('nav.profile'),
      icon: iconProfile,
      active: isActive('/profile'),
      badge: notifBadge,
      alertBadge: true,
      onSelect: () => goTo('/profile'),
    },
    {
      key: 'rankings',
      label: t('nav.rankings'),
      icon: iconRanking,
      active: isActive('/rankings'),
      onSelect: () => goTo('/rankings'),
    },
    {
      key: 'logout',
      label: t('nav.logout'),
      icon: iconLogout,
      active: false,
      onSelect: () => {
        void handleLogout();
      },
    },
  ];

  const desktopItems: NavEntry[] = [
    {
      key: 'dashboard',
      label: t('nav.dashboard'),
      icon: iconHome,
      active: isActive('/dashboard'),
      badge: homeBadge,
      alertBadge: true,
      onSelect: () => goTo('/dashboard'),
    },
    {
      key: 'forums',
      label: t('nav.forums'),
      icon: iconForum,
      active: isForumActive,
      badge: forumBadge,
      alertBadge: true,
      onSelect: () => goTo('/forums'),
    },
    {
      key: 'sepbook',
      label: t('nav.sepbook'),
      icon: iconSEPBook,
      active: isSepbookActive,
      badge: sepbookBadgeTotal,
      alertBadge: sepbookMentions > 0,
      onSelect: () => goTo('/sepbook'),
    },
    {
      key: 'study',
      label: t('nav.study'),
      icon: iconStudy,
      active: isActive('/study'),
      badge: studyBadge,
      alertBadge: true,
      onSelect: () => goTo('/study'),
    },
    ...(showEvaluations
      ? [
          {
            key: 'evaluations',
            label: t('nav.evaluations'),
            icon: iconAvaliar,
            active: isActive('/evaluations'),
            badge: evalBadge,
            alertBadge: true,
            onSelect: () => goTo('/evaluations'),
          } as NavEntry,
        ]
      : []),
    ...(studioAccess
      ? [
          {
            key: 'studio',
            label: t('nav.studio'),
            icon: iconStudio,
            active: isActive('/studio'),
            badge: studioBadge,
            alertBadge: true,
            onSelect: () => goTo('/studio'),
          } as NavEntry,
        ]
      : []),
    {
      key: 'profile',
      label: t('nav.profile'),
      icon: iconProfile,
      active: isActive('/profile'),
      badge: notifBadge,
      alertBadge: true,
      onSelect: () => goTo('/profile'),
    },
    {
      key: 'rankings',
      label: t('nav.rankings'),
      icon: iconRanking,
      active: isActive('/rankings'),
      onSelect: () => goTo('/rankings'),
    },
    {
      key: 'logout',
      label: t('nav.logout'),
      icon: iconLogout,
      active: false,
      onSelect: () => {
        void handleLogout();
      },
    },
  ];

  if (navHidden && !navExpanded) {
    return (
      <>
        <div
          className="fixed bottom-0 right-0 z-30 p-3 lg:hidden"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          <button
            type="button"
            onClick={() => setNavExpanded(true)}
            className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/85 text-white shadow-[0_10px_24px_rgba(0,0,0,0.55)] backdrop-blur-md"
            aria-label="Abrir menu"
            title="Abrir menu"
          >
            <Menu className="h-6 w-6" />
            {totalBadge > 0 && <span className={badgeClass(true)}>{totalBadge > 99 ? '99+' : totalBadge}</span>}
          </button>
        </div>

        <div className="fixed left-4 top-4 z-30 hidden lg:block">
          <button
            type="button"
            onClick={() => setNavExpanded(true)}
            className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/85 text-white shadow-[0_10px_24px_rgba(0,0,0,0.55)] backdrop-blur-md"
            aria-label="Abrir menu"
            title="Abrir menu"
          >
            <Menu className="h-6 w-6" />
            {totalBadge > 0 && <span className={badgeClass(true)}>{totalBadge > 99 ? '99+' : totalBadge}</span>}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 bg-transparent lg:hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
        aria-label="Navegação principal"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${bgMenu})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              filter: 'brightness(0.82) saturate(1.08)',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/70 to-transparent" />
        </div>

        <div className="mx-auto max-w-[640px] px-2">
          <div className="relative rounded-2xl border border-white/10 bg-slate-950/85 px-2 py-2 shadow-2xl backdrop-blur-xl">
            {navHidden && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-2 top-2 h-9 w-9"
                onClick={() => {
                  setNavExpanded(false);
                }}
                aria-label="Fechar menu"
                title="Fechar menu"
              >
                <X className="h-5 w-5" />
              </Button>
            )}

            <div
              className={cn(
                'hide-scrollbar flex gap-1 overflow-x-auto pb-1',
                navHidden ? 'pr-10' : '',
              )}
            >
              {mobileItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    'flex min-h-[70px] min-w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-1.5 text-[11px] font-semibold leading-4 text-slate-200 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
                    item.active && 'text-slate-50',
                  )}
                  onClick={item.onSelect}
                  aria-label={item.label}
                  aria-current={item.active ? 'page' : undefined}
                >
                  <span className={bubbleClass(item.active)}>
                    <span className="absolute inset-[3px] rounded-2xl overflow-hidden">
                      <img src={item.icon} alt="" aria-hidden className="h-full w-full object-cover" />
                    </span>
                    {(item.badge || 0) > 0 && (
                      <span className={badgeClass(item.alertBadge)}>{(item.badge || 0) > 99 ? '99+' : item.badge}</span>
                    )}
                  </span>
                  <span className="max-w-[70px] truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <aside
        className="fixed bottom-1 left-2 top-1 z-30 hidden w-[var(--djt-nav-desktop-w)] lg:block"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)', ['--djt-nav-scale' as any]: desktopNavScale }}
        aria-label="Navegação lateral"
      >
        <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/88 p-1.5 shadow-2xl backdrop-blur-xl">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${bgMenu})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                filter: 'brightness(0.75) saturate(1.08)',
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950/70 to-slate-900/60" />
          </div>

          <div className="mb-0.5 flex items-center justify-between">
            <p className="pl-1 font-semibold tracking-wide text-slate-100" style={{ fontSize: `${Math.max(11, Math.round(14 * desktopNavScale))}px` }}>
              Menu
            </p>
            {navHidden && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-2 top-2 h-8 w-8"
                onClick={() => {
                  setNavExpanded(false);
                }}
                aria-label="Fechar menu"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-hidden pr-0">
            <div className="space-y-px pb-0">
              {desktopItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    'group flex min-h-[calc(46px*var(--djt-nav-scale,1))] w-full items-center justify-start gap-[calc(0.42rem*var(--djt-nav-scale,1))] rounded-xl px-[calc(0.4rem*var(--djt-nav-scale,1))] py-[calc(0.2rem*var(--djt-nav-scale,1))] text-left text-slate-100 transition-colors hover:bg-white/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
                    item.active && 'bg-white/10',
                  )}
                  onClick={item.onSelect}
                  aria-label={item.label}
                  aria-current={item.active ? 'page' : undefined}
                  title={item.label}
                >
                  <span className={bubbleClass(item.active, 'xl')}>
                    <span className="absolute inset-[1px] rounded-2xl overflow-hidden">
                      <img src={item.icon} alt="" aria-hidden className="h-full w-full object-cover" />
                    </span>
                    {(item.badge || 0) > 0 && (
                      <span className={badgeClass(item.alertBadge)}>{(item.badge || 0) > 99 ? '99+' : item.badge}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold leading-4" style={{ fontSize: `${Math.max(11, Math.round(12 * desktopNavScale))}px` }}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

        </div>
      </aside>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('profile.changePasswordTitle')}</DialogTitle>
            <DialogDescription className="sr-only">Alterar senha</DialogDescription>
          </DialogHeader>
          <ChangePasswordCard compact />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Navigation;
