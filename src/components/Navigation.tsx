import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Target, Shield, Trophy, User, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { studioAccess, isLeader } = useAuth();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t z-50 md:hidden">
      <div className="container flex items-center justify-around py-2">
        <Button
          variant={isActive('/') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/')}
          className="flex-col h-auto py-2"
        >
          <Home className="h-5 w-5" />
          <span className="text-xs mt-1">Início</span>
        </Button>
        
        <Button
          variant={isActive('/rankings') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/rankings')}
          className="flex-col h-auto py-2"
        >
          <Trophy className="h-5 w-5" />
          <span className="text-xs mt-1">Rankings</span>
        </Button>
        
        <Button
          variant={location.pathname.startsWith('/forum') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/forums')}
          className="flex-col h-auto py-2"
        >
          <MessageSquare className="h-5 w-5" />
          <span className="text-xs mt-1">Fóruns</span>
        </Button>
        
        {isLeader && (
          <Button
            variant={isActive('/evaluations') ? 'default' : 'ghost'}
            size="sm"
            onClick={() => navigate('/evaluations')}
            className="flex-col h-auto py-2"
          >
            <Shield className="h-5 w-5" />
            <span className="text-xs mt-1">Avaliar</span>
          </Button>
        )}
        
        {studioAccess && (
          <Button
            variant={isActive('/studio') ? 'default' : 'ghost'}
            size="sm"
            onClick={() => navigate('/studio')}
            className="flex-col h-auto py-2"
          >
            <Target className="h-5 w-5" />
            <span className="text-xs mt-1">Studio</span>
          </Button>
        )}
        
        <Button
          variant={isActive('/profile') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/profile')}
          className="flex-col h-auto py-2"
        >
          <User className="h-5 w-5" />
          <span className="text-xs mt-1">Perfil</span>
        </Button>
      </div>
    </nav>
  );
};

export default Navigation;
