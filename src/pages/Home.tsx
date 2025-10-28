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
      className={`min-h-screen flex flex-col items-center justify-between p-6 pt-16 pb-12 relative overflow-hidden ${isTransitioning ? 'animate-page-fade-out' : ''}`}
      style={{
        backgroundImage: `url(${djtCover})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Gradient overlay for better contrast */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/40" />
      
      {/* Top content */}
      <div className="relative z-10 flex flex-col items-center gap-4 animate-fade-in max-w-2xl text-center">
        <div className="space-y-3 px-6 py-4 rounded-2xl backdrop-blur-sm bg-black/20">
          <p className="text-2xl sm:text-3xl text-white font-bold drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]">
            Desenvolva habilidades, ganhe XP<br />e conquiste sua evolução profissional
          </p>
          <p className="text-sm sm:text-base text-white/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] font-medium">
            CPFL Piratininga e Santa Cruz Subtransmissão
          </p>
        </div>
      </div>

      {/* Center GO Button */}
      <div className="relative z-10 flex items-center justify-center">
        <Button 
          onClick={handleGo}
          disabled={isTransitioning}
          size="lg"
          className={`h-20 px-16 text-3xl font-bold bg-gradient-to-r from-primary to-secondary shadow-[0_0_40px_rgba(0,0,0,0.6),0_8px_24px_rgba(0,0,0,0.4)] group ${
            isTransitioning 
              ? 'animate-slide-fade-left cursor-not-allowed' 
              : 'hover:scale-110 hover:shadow-[0_0_60px_rgba(255,255,255,0.3)] transition-all duration-300'
          }`}
        >
          <Play className="mr-3 h-10 w-10 group-hover:translate-x-1 transition-transform" />
          GO
        </Button>
      </div>
      
      {/* Bottom badges */}
      <div className="relative z-10 flex flex-wrap justify-center gap-3 text-xs sm:text-sm text-white">
        <span className="px-4 py-2 bg-white/20 backdrop-blur-md rounded-full border border-white/30 font-medium shadow-lg">Conhecimento</span>
        <span className="px-4 py-2 bg-white/20 backdrop-blur-md rounded-full border border-white/30 font-medium shadow-lg">Habilidade</span>
        <span className="px-4 py-2 bg-white/20 backdrop-blur-md rounded-full border border-white/30 font-medium shadow-lg">Atitude</span>
        <span className="px-4 py-2 bg-white/20 backdrop-blur-md rounded-full border border-white/30 font-medium shadow-lg">Segurança</span>
      </div>
    </div>
  );
};

export default Home;
