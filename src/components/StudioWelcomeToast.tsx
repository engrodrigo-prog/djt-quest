import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

export function StudioWelcomeToast() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleWelcome = () => {
      toast({
        title: "🎉 Novo acesso desbloqueado!",
        description: "Você agora tem acesso ao DJT Quest Studio",
        action: (
          <Button 
            size="sm" 
            onClick={() => navigate('/studio')}
          >
            Ir para Studio
          </Button>
        ),
        duration: 8000,
      });
    };

    window.addEventListener('show-studio-welcome', handleWelcome);
    return () => window.removeEventListener('show-studio-welcome', handleWelcome);
  }, [navigate]);

  return null;
}
