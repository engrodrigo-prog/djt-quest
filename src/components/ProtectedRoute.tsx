import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  requireStudio?: boolean;
  requireLeader?: boolean;
  allowedRoles?: string[];
}

export function ProtectedRoute({
  children,
  requireStudio = false,
  requireLeader = false,
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, loading, studioAccess, isLeader, userRole } = useAuth();
  const navigate = useNavigate();

  const allowedRolesKey = allowedRoles?.join(',') ?? '';

  useEffect(() => {
    const needsRole = requireStudio || requireLeader || allowedRolesKey.length > 0;
    const roleNotLoadedYet = needsRole && user && userRole === null;

    const requiresSpecificRole = allowedRolesKey.length > 0;
    const allowedRolesList = requiresSpecificRole ? allowedRolesKey.split(',') : [];
    const roleNotAllowed =
      requiresSpecificRole && (!userRole || !allowedRolesList.includes(userRole));

    if (!loading && !user) {
      navigate('/auth');
    } else if (!loading && user) {
      // Aguarda resolução do papel antes de decidir navegação
      if (roleNotLoadedYet) return;

      if (requireStudio && !studioAccess) {
        navigate('/');
        return;
      }

      if (requireLeader && !isLeader) {
        navigate('/');
        return;
      }

      if (roleNotAllowed) {
        navigate('/');
      }
    }
  }, [user, loading, studioAccess, requireStudio, isLeader, requireLeader, allowedRolesKey, userRole, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const needsRole = requireStudio || requireLeader || allowedRolesKey.length > 0;
  if (user && needsRole && userRole === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (
    !user ||
    (requireStudio && !studioAccess) ||
    (requireLeader && !isLeader) ||
    (allowedRolesKey.length > 0 &&
      (!userRole || !allowedRolesKey.split(',').includes(userRole)))
  ) {
    return null;
  }

  return <>{children}</>;
}
