import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Shield, Zap, Play } from 'lucide-react';
import splashBg from '@/assets/backgrounds/splash-bg.png';

const Home = () => {
  const navigate = useNavigate();

  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden"
      style={{
        backgroundImage: `url(${splashBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Dark overlay for better text contrast */}
      <div className="absolute inset-0 bg-black/40" />
      
      <div className="relative z-10 flex flex-col items-center gap-8 animate-fade-in max-w-2xl text-center">
        {/* Logo Icons */}
        <div className="flex items-center gap-3 mb-4">
          <Shield className="h-16 w-16 text-primary drop-shadow-lg animate-pulse" />
          <Zap className="h-16 w-16 text-secondary drop-shadow-lg animate-pulse" style={{ animationDelay: '0.5s' }} />
        </div>
        
        {/* Main Title */}
        <h1 className="text-7xl sm:text-8xl font-bold text-white drop-shadow-2xl leading-tight">
          DJT Quest
        </h1>
        
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
          onClick={() => navigate('/dashboard')}
          size="lg"
          className="mt-8 h-16 px-12 text-2xl font-bold bg-gradient-to-r from-primary to-secondary hover:scale-110 transition-all duration-300 shadow-2xl group"
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
