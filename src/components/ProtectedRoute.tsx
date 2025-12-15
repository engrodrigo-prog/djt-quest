import { ReactNode, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { CompleteProfile } from '@/components/CompleteProfile';

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
  const { user, loading, studioAccess, isLeader, userRole, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const allowedRolesKey = allowedRoles?.join(',') ?? '';
  const needsProfileCompletion = Boolean(
    user && profile && (profile.must_change_password || profile.needs_profile_completion),
  );

  useEffect(() => {
    const needsRole = requireStudio || requireLeader || allowedRolesKey.length > 0;
    const roleNotLoadedYet = needsRole && user && userRole === null;

    const requiresSpecificRole = allowedRolesKey.length > 0;
    const allowedRolesList = requiresSpecificRole ? allowedRolesKey.split(',') : [];
    const roleNotAllowed =
      requiresSpecificRole && (!userRole || !allowedRolesList.includes(userRole));

    if (!loading && !user) {
      const next = `${location.pathname}${location.search}${location.hash}`;
      navigate(`/auth?redirect=${encodeURIComponent(next)}`);
    } else if (!loading && user) {
      if (needsProfileCompletion) return;

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
  }, [user, loading, needsProfileCompletion, studioAccess, requireStudio, isLeader, requireLeader, allowedRolesKey, userRole, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (needsProfileCompletion) {
    return <CompleteProfile profile={profile} />;
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
