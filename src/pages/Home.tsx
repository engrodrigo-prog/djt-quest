import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import djtCover from '@/assets/backgrounds/djt-quest-cover.png';

const Home = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleGo = () => {
    setIsTransitioning(true);
    
    setTimeout(() => {
      if (user) {
        navigate('/dashboard');
      } else {
        navigate('/auth');
      }
    }, 600);
  };

  return (
    <div 
      className={`min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden ${isTransitioning ? 'animate-page-fade-out' : ''}`}
      style={{
        backgroundImage: `url(${djtCover})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="relative z-10 flex flex-col items-center gap-6 animate-fade-in max-w-2xl text-center">
        {/* Subtitle */}
        <div className="space-y-2">
          <p className="text-xl sm:text-2xl text-white/95 drop-shadow-lg font-medium">
            Desenvolva habilidades, ganhe XP<br />e conquiste sua evolução profissional
          </p>
          <p className="text-sm text-white/80 drop-shadow-lg">
            CPFL Piratininga e Santa Cruz Subtransmissão
          </p>
        </div>
        
        {/* GO Button */}
        <Button 
          onClick={handleGo}
          disabled={isTransitioning}
          size="lg"
          className={`mt-8 h-16 px-12 text-2xl font-bold bg-gradient-to-r from-primary to-secondary shadow-2xl group ${
            isTransitioning 
              ? 'animate-slide-fade-left cursor-not-allowed' 
              : 'hover:scale-110 transition-all duration-300'
          }`}
        >
          <Play className="mr-3 h-8 w-8 group-hover:translate-x-1 transition-transform" />
          GO
        </Button>
        
        {/* Bottom badges */}
        <div className="mt-12 flex flex-wrap justify-center gap-3 text-xs text-white/70">
          <span className="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full">Conhecimento</span>
          <span className="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full">Habilidade</span>
          <span className="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full">Atitude</span>
          <span className="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full">Segurança</span>
        </div>
      </div>
    </div>
  );
};

export default Home;
