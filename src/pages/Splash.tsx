import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import splashBg from '@/assets/backgrounds/splash-bg.png';

const Splash = () => {
  const navigate = useNavigate();
  const [show, setShow] = useState(true);

  useEffect(() => {
    const hasSeenSplash = localStorage.getItem('hasSeenSplash');
    
    if (hasSeenSplash) {
      navigate('/');
      return;
    }

    const timer = setTimeout(() => {
      setShow(false);
      localStorage.setItem('hasSeenSplash', 'true');
      navigate('/');
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  const handleSkip = () => {
    localStorage.setItem('hasSeenSplash', 'true');
    navigate('/');
  };

  if (!show) return null;

  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{
        backgroundImage: `url(${splashBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="flex flex-col items-center gap-8 animate-fade-in">
        <h1 className="text-6xl font-bold text-white text-center mb-4">
          Bem-vindo ao DJT Quest
        </h1>
        <p className="text-xl text-white/90 text-center max-w-md">
          Desenvolva habilidades, ganhe XP e conquiste sua evolução profissional
        </p>
        <Button 
          onClick={handleSkip}
          size="lg"
          className="mt-8 bg-djt-orange hover:bg-djt-orange/90 text-white font-bold"
        >
          VER RANKING
        </Button>
      </div>
    </div>
  );
};

export default Splash;
