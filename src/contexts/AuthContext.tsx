import { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getAppOrigin } from '@/lib/whatsappShare';

interface OrgScope {
  teamId: string | null;
  teamName?: string;
  coordId: string | null;
  coordName?: string;
  divisionId: string;
  divisionName?: string;
  departmentId: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  hasActiveSession: boolean;
  userRole: string | null;
  roles: string[];
  isContentCurator: boolean;
  studioAccess: boolean;
  isLeader: boolean;
  orgScope: OrgScope | null;
  profile: any | null;
  roleOverride: 'colaborador' | 'lider' | null;
  setRoleOverride: (val: 'colaborador' | 'lider' | null) => void;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, name: string) => Promise<{ data: any; error: any }>;
  signOut: () => Promise<void>;
  refreshUserSession: () => Promise<{
    role: string | null;
    roles: string[];
    isContentCurator: boolean;
    studioAccess: boolean;
    isLeader: boolean;
    orgScope: OrgScope | null;
    profile: any | null;
  } | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Cache configuration
const CACHE_KEY = 'auth_user_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ROLE_OVERRIDE_KEY = 'auth_role_override';
const SESSION_DAY_KEY = 'auth_session_day_key';
const ACCESS_TZ = 'America/Sao_Paulo';

const getCachedAuth = () => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    
    return data;
  } catch {
    return null;
  }
};

const isTimeoutError = (err: any) => String(err?.message || err || '').toLowerCase().includes('timeout');
const isDev = typeof import.meta !== 'undefined' && Boolean((import.meta as any)?.env?.DEV);

// Helper to avoid hanging fetches impacting UI loading state
async function withTimeout<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)) as Promise<T>,
  ]);
}

const dayKeyInTimeZone = (date: Date, timeZone = ACCESS_TZ) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    if (map.year && map.month && map.day) return `${map.year}-${map.month}-${map.day}`;
  } catch {
    // noop
  }
  return date.toISOString().slice(0, 10);
};

const accessKeyForToday = (userId: string) => {
  const day = dayKeyInTimeZone(new Date(), ACCESS_TZ);
  return `access_daily_${userId}_${day}`;
};

const tryTrackAccess = async (token: string | null | undefined, userId: string | null | undefined, kind: 'daily' | 'session' | 'login' | 'pageview') => {
  try {
    if (!token || !userId) return;
    const key = accessKeyForToday(userId);
    if (localStorage.getItem(key) === '1') return;
    localStorage.setItem(key, '1');
    await fetch('/api/admin?handler=track-access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ kind: 'daily', path: window.location.pathname }),
    });
  } catch {
    // best-effort
  }
};

const setCachedAuth = (data: any) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Error caching auth data:', error);
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [baseRole, setBaseRole] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [isContentCurator, setIsContentCurator] = useState(false);
  const [studioAccess, setStudioAccess] = useState(false);
  const [baseStudioAccess, setBaseStudioAccess] = useState(false);
  const [isLeader, setIsLeader] = useState(false);
  const [baseIsLeader, setBaseIsLeader] = useState(false);
  const [orgScope, setOrgScope] = useState<OrgScope | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [previousRole, setPreviousRole] = useState<string | null>(null);
  const [hasShownWelcome, setHasShownWelcome] = useState(false);
  const roleRef = useRef<string | null>(null);
  const welcomeRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const [roleOverride, setRoleOverrideState] = useState<'colaborador' | 'lider' | null>(() => {
    try {
      const v = localStorage.getItem(ROLE_OVERRIDE_KEY);
      if (v === 'colaborador' || v === 'lider') return v;
      return null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    roleRef.current = userRole;
  }, [userRole]);

  useEffect(() => {
    welcomeRef.current = hasShownWelcome;
  }, [hasShownWelcome]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  const applyOverride = (authData: { role: string | null; studioAccess: boolean; isLeader: boolean }) => {
    const { role, studioAccess: studio, isLeader: leader } = authData;
    if (roleOverride === 'colaborador') {
      setUserRole('colaborador');
      setIsLeader(false);
      setStudioAccess(false);
      return;
    }
    if (roleOverride === 'lider') {
      setUserRole('gerente_djt');
      setIsLeader(true);
      setStudioAccess(true);
      return;
    }
    setUserRole(role);
    setIsLeader(leader);
    setStudioAccess(studio);
  };

  const setRoleOverride = (val: 'colaborador' | 'lider' | null) => {
    setRoleOverrideState(val);
    try {
      if (val) localStorage.setItem(ROLE_OVERRIDE_KEY, val);
      else localStorage.removeItem(ROLE_OVERRIDE_KEY);
    } catch {
      /* ignore */
    }
    applyOverride({
      role: baseRole,
      studioAccess: baseStudioAccess,
      isLeader: baseIsLeader,
    });
  };

  const fetchUserSession = async (providedSession?: Session | null) => {
    const cached = getCachedAuth();
    if (cached) {
      setBaseRole(cached.role);
      setBaseStudioAccess(cached.studioAccess);
      setBaseIsLeader(cached.isLeader);
      applyOverride({
        role: cached.role,
        studioAccess: cached.studioAccess,
        isLeader: cached.isLeader,
      });
      setRoles(Array.isArray(cached.roles) ? cached.roles : []);
      setIsContentCurator(Boolean(cached.isContentCurator) || (Array.isArray(cached.roles) && cached.roles.includes('content_curator')));
      setOrgScope(cached.orgScope);
      setProfile(cached.profile);
    }

    try {
      const currentSession = providedSession ?? null;

      if (!currentSession) {
        // Trata como deslogado e sai sem loop
        setUser(null);
        setSession(null);
        setHasActiveSession(false);
        setBaseRole(null);
        setBaseStudioAccess(false);
        setBaseIsLeader(false);
        applyOverride({
          role: null,
          studioAccess: false,
          isLeader: false,
        });
        setRoles([]);
        setIsContentCurator(false);
        setOrgScope(null);
        setProfile(null);
        return null;
      }

      const { data, error } = await withTimeout(
        supabase.functions.invoke('auth-me', {
          body: {},
          headers: {
            Authorization: `Bearer ${currentSession.access_token}`,
          },
        }),
        15000
      );

      if (error) {
        if (isDev) console.warn('auth-me falhou', error.message || error);
        // Não derruba a sessão; apenas mantém usuário básico sem papel carregado
        setUser(currentSession.user ?? null);
        setSession(currentSession);
        setHasActiveSession(true);

        if (cached) {
          setBaseRole(cached.role);
          setBaseStudioAccess(cached.studioAccess);
          setBaseIsLeader(cached.isLeader);
          applyOverride({
            role: cached.role,
            studioAccess: cached.studioAccess,
            isLeader: cached.isLeader,
          });
          setRoles(Array.isArray(cached.roles) ? cached.roles : []);
          setIsContentCurator(Boolean(cached.isContentCurator) || (Array.isArray(cached.roles) && cached.roles.includes('content_curator')));
          setOrgScope(cached.orgScope);
          setProfile(cached.profile);
          return cached;
        }

        // Sem dados de papel, segue como logado porém sem privilégios especiais
        setBaseRole(null);
        setBaseStudioAccess(false);
        setBaseIsLeader(false);
        applyOverride({
          role: null,
          studioAccess: false,
          isLeader: false,
        });
        setRoles([]);
        setIsContentCurator(false);
        setOrgScope(null);
        setProfile(null);
        return null;
      }

      const authData = {
        role: data.role,
        roles: Array.isArray((data as any).roles) ? (data as any).roles : [],
        isContentCurator: Boolean((data as any).isContentCurator) || (Array.isArray((data as any).roles) && (data as any).roles.includes('content_curator')),
        studioAccess: data.studioAccess,
        isLeader: data.isLeader,
        orgScope: data.orgScope,
        profile: data.profile,
      };

      setCachedAuth(authData);
      setBaseRole(data.role);
      setBaseStudioAccess(data.studioAccess);
      setBaseIsLeader(Boolean(data.isLeader));
      applyOverride({
        role: data.role,
        studioAccess: data.studioAccess,
        isLeader: Boolean(data.isLeader),
      });
      setRoles(Array.isArray((data as any).roles) ? (data as any).roles : []);
      setIsContentCurator(Boolean((data as any).isContentCurator) || (Array.isArray((data as any).roles) && (data as any).roles.includes('content_curator')));
      setOrgScope(data.orgScope);
      setProfile(data.profile);
      setUser(currentSession.user ?? null);
      setSession(currentSession ?? null);
      setHasActiveSession(!!currentSession);

      return authData;
    } catch (error: any) {
      // Avoid noisy console errors on slow networks; cache fallback handles UX.
      if (isDev && !isTimeoutError(error)) console.warn('Erro ao buscar sessão', error?.message || error);

      // Mantém a sessão corrente como válida
      setUser(providedSession?.user ?? null);
      setSession(providedSession ?? null);
      setHasActiveSession(!!providedSession);

      if (cached) {
        setBaseRole(cached.role);
        setBaseStudioAccess(cached.studioAccess);
        setBaseIsLeader(cached.isLeader);
        applyOverride({
          role: cached.role,
          studioAccess: cached.studioAccess,
          isLeader: cached.isLeader,
        });
        setRoles(Array.isArray(cached.roles) ? cached.roles : []);
        setIsContentCurator(Boolean(cached.isContentCurator) || (Array.isArray(cached.roles) && cached.roles.includes('content_curator')));
        setOrgScope(cached.orgScope);
        setProfile(cached.profile);
        return cached;
      }

      setBaseRole(null);
      setBaseStudioAccess(false);
      setBaseIsLeader(false);
      applyOverride({
        role: null,
        studioAccess: false,
        isLeader: false,
      });
      setRoles([]);
      setIsContentCurator(false);
      setOrgScope(null);
      setProfile(null);
      return null;
    }
  };

  const refreshUserSession = async () => {
    localStorage.removeItem(CACHE_KEY);
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    return await fetchUserSession(currentSession);
  };

  useEffect(() => {
    // Inicializa sessão atual ao montar
    let active = true;
    (async () => {
      try {
        const { data: { session: rawSession } } = await supabase.auth.getSession();
        let currentSession = rawSession ?? null;
        if (!active) return;

        if (currentSession) {
          try {
            const storedDayKey = localStorage.getItem(SESSION_DAY_KEY);
            const nowDayKey = dayKeyInTimeZone(new Date(), ACCESS_TZ);
            if (storedDayKey && storedDayKey !== nowDayKey) {
              localStorage.removeItem(CACHE_KEY);
              localStorage.removeItem(ROLE_OVERRIDE_KEY);
              localStorage.removeItem(SESSION_DAY_KEY);
              await supabase.auth.signOut();
              currentSession = null;
            } else {
              localStorage.setItem(SESSION_DAY_KEY, nowDayKey);
            }
          } catch {
            // ignore
          }

          if (currentSession) {
            tryTrackAccess(currentSession.access_token, currentSession.user?.id, 'daily');
            await fetchUserSession(currentSession);
          }
        }

        if (!currentSession) {
          setUser(null);
          setSession(null);
          setHasActiveSession(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    // Listener para mudanças futuras de auth (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const previousUserId = userIdRef.current;

        // Clear cache if user changed
        if (session?.user.id !== previousUserId && previousUserId) {
          localStorage.removeItem(CACHE_KEY);
        }

        setSession(session);
        setUser(session?.user ?? null);
        setHasActiveSession(!!session);

        if (session) {
          const oldRole = roleRef.current;
          try {
            localStorage.setItem(SESSION_DAY_KEY, dayKeyInTimeZone(new Date(), ACCESS_TZ));
          } catch {
            // ignore
          }
          tryTrackAccess(session.access_token, session.user?.id, 'daily');
          fetchUserSession(session)
            .then((authData) => {
              if (oldRole === 'colaborador' && authData?.role && authData.role.includes('gerente') && !welcomeRef.current) {
                setHasShownWelcome(true);
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('show-studio-welcome'));
                }, 1000);
              }
            })
            .catch((err) => {
              console.error('Auth fetch (background) error:', err);
            });
        } else {
          setUserRole(null);
          setStudioAccess(false);
          setIsLeader(false);
          setRoles([]);
          setIsContentCurator(false);
          setOrgScope(null);
        }
      }
    );

    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) return { error: null };

      const msg = String((error as any)?.message || '');
      const name = String((error as any)?.name || '');
      const maybeNetwork = msg.toLowerCase().includes('failed to fetch') || name.toLowerCase().includes('fetch');
      if (!maybeNetwork) return { error };
    } catch (err: any) {
      const msg = String(err?.message || err);
      const maybeNetwork = msg.toLowerCase().includes('failed to fetch');
      if (!maybeNetwork) return { error: err };
    }

    // Fallback: proxy auth through our own Vercel function to bypass client network blocks.
    try {
      const resp = await fetch('/api/auth-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const payload = await resp.json().catch(() => null);
      if (!resp.ok) return { error: { message: payload?.error || 'Falha ao autenticar' } as any };

      const access_token = payload?.access_token;
      const refresh_token = payload?.refresh_token;
      if (!access_token || !refresh_token) return { error: { message: 'Resposta inválida do servidor' } as any };

      const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
      return { error: setErr ?? null };
    } catch (err: any) {
      return { error: { message: err?.message || 'Falha ao autenticar (fallback)' } as any };
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    const redirectUrl = `${getAppOrigin() || window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { name }
      }
    });
    return { data, error };
  };

  const signOut = async () => {
    console.log('🚪 Signing out, clearing cache');
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(ROLE_OVERRIDE_KEY);
    localStorage.removeItem(SESSION_DAY_KEY);
    await supabase.auth.signOut();
  };

  // Daily forced logout at 00:00 (America/Sao_Paulo) to simplify daily access counting.
  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      try {
        const storedDayKey = localStorage.getItem(SESSION_DAY_KEY);
        const nowDayKey = dayKeyInTimeZone(new Date(), ACCESS_TZ);
        if (storedDayKey && storedDayKey !== nowDayKey) {
          void signOut();
        }
      } catch {
        // ignore
      }
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [session?.access_token]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading, 
      hasActiveSession,
      userRole, 
      roles,
      isContentCurator,
      studioAccess,
      isLeader,
      orgScope,
      profile,
      roleOverride,
      setRoleOverride,
      signIn,
      signUp, 
      signOut,
      refreshUserSession
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
