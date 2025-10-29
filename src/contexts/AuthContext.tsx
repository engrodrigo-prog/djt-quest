import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

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
  userRole: string | null;
  studioAccess: boolean;
  isLeader: boolean;
  orgScope: OrgScope | null;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, name: string) => Promise<{ data: any; error: any }>;
  signOut: () => Promise<void>;
  refreshUserSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Cache configuration
const CACHE_KEY = 'auth_user_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  const [userRole, setUserRole] = useState<string | null>(null);
  const [studioAccess, setStudioAccess] = useState(false);
  const [isLeader, setIsLeader] = useState(false);
  const [orgScope, setOrgScope] = useState<OrgScope | null>(null);

  const fetchUserSession = async (currentSession: Session) => {
    // Try cache first
    const cached = getCachedAuth();
    if (cached) {
      setUserRole(cached.role);
      setStudioAccess(cached.studioAccess);
      setIsLeader(cached.isLeader);
      setOrgScope(cached.orgScope);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('auth-me', {
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`
        }
      });

      if (error) throw error;

      // Cache the result
      setCachedAuth(data);
      
      setUserRole(data.role);
      setStudioAccess(data.studioAccess);
      setIsLeader(data.isLeader || false);
      setOrgScope(data.orgScope);
    } catch (error) {
      console.error('Error fetching user session:', error);
      setUserRole('colaborador');
      setStudioAccess(false);
      setIsLeader(false);
      setOrgScope(null);
    }
  };

  const refreshUserSession = async () => {
    // Clear cache to force refresh
    localStorage.removeItem(CACHE_KEY);
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (currentSession) {
      await fetchUserSession(currentSession);
    }
  };

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session) {
          await fetchUserSession(session);
        } else {
          setUserRole(null);
          setStudioAccess(false);
          setIsLeader(false);
          setOrgScope(null);
        }
        
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session) {
        await fetchUserSession(session);
      }
      
      setLoading(false);
    });

    return () => subscription.unsubscribe();
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
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading, 
      userRole, 
      studioAccess,
      isLeader,
      orgScope,
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
