import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Target, Shield, Trophy, User, MessageSquare, Lock, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { studioAccess, isLeader } = useAuth();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav
      className="fixed md:static bottom-0 left-0 right-0 bg-card border-t z-50"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      <div className="max-w-full px-2 flex items-center justify-between gap-1 py-2 overflow-x-auto">
        <Button
          variant={isActive('/dashboard') ? 'default' : 'ghost'}
          size="sm"
          onClick={() => navigate('/dashboard')}
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
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isActive('/studio') ? 'default' : 'ghost'}
                size="sm"
                onClick={() => studioAccess ? navigate('/studio') : null}
                disabled={!studioAccess}
                className={cn(
                  "flex-col h-auto py-2 relative",
                  !studioAccess && "opacity-50 cursor-not-allowed"
                )}
              >
                <Target className="h-5 w-5" />
                <span className="text-xs mt-1">Studio</span>
                {!studioAccess && <Lock className="h-3 w-3 absolute top-1 right-1" />}
              </Button>
            </TooltipTrigger>
            {!studioAccess && (
              <TooltipContent>
                <p>Requer perfil de Líder ou Gerente</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        
        <Button
          variant={'ghost'}
          size="sm"
          onClick={() => setPasswordDialogOpen(true)}
          className="flex-col h-auto py-2"
        >
          <Key className="h-5 w-5" />
          <span className="text-xs mt-1">Senha</span>
        </Button>

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
