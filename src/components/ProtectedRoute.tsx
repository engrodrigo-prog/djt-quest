import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  requireStudio?: boolean;
}

export function ProtectedRoute({ children, requireStudio = false }: ProtectedRouteProps) {
  const { user, loading, studioAccess } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    } else if (!loading && user && requireStudio && !studioAccess) {
      navigate('/');
    }
  }, [user, loading, studioAccess, requireStudio, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user || (requireStudio && !studioAccess)) {
    return null;
  }

  return <>{children}</>;
}
