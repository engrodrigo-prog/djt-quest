import { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

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

// Helper to avoid hanging fetches impacting UI loading state
async function withTimeout<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)) as Promise<T>,
  ]);
}

const accessKeyForToday = (userId: string, kind: string) => {
  const day = new Date().toISOString().slice(0, 10);
  return `access_${kind}_${userId}_${day}`;
};

const tryTrackAccess = async (token: string | null | undefined, userId: string | null | undefined, kind: 'session' | 'login' | 'pageview') => {
  try {
    if (!token || !userId) return;
    const key = accessKeyForToday(userId, kind);
    if (localStorage.getItem(key) === '1') return;
    localStorage.setItem(key, '1');
    await fetch('/api/admin?handler=track-access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ kind }),
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
        8000
      );

      if (error) {
        console.warn('auth-me falhou', error.message || error);
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
      console.warn('Erro ao buscar sessão', error?.message || error);

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
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!active) return;

        if (currentSession) {
          tryTrackAccess(currentSession.access_token, currentSession.user?.id, 'session');
          await fetchUserSession(currentSession);
        } else {
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
          tryTrackAccess(session.access_token, session.user?.id, 'session');
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
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string, name: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
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
    await supabase.auth.signOut();
  };

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
